import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/lib/db/types";

// X03-T8 (seed section `library`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check determinism, mirroring tests/db/seed-determinism.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

/** Real demo sign-in (same pattern as tests/db/dashboard-queries.test.ts), so the "guardian.one reads exactly her children's loans" test exercises RLS for real. */
async function signInDemo(loginKey: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) throw error;
  return client;
}

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("X03-T8 seed section library", () => {
  it("has at least 100 books and 200 copies", async () => {
    const [books] = await sql`select count(*)::int as n from public.library_books where institution_id = ${institutionId}`;
    const [copies] = await sql`select count(*)::int as n from public.library_copies where institution_id = ${institutionId}`;
    expect(books.n).toBeGreaterThanOrEqual(100);
    expect(copies.n).toBeGreaterThanOrEqual(200);
  });

  it("never gives one copy two open loans", async () => {
    const rows = await sql`
      select copy_id from public.library_loans
      where institution_id = ${institutionId} and returned_on is null
      group by copy_id having count(*) > 1
    `;
    expect(rows.length).toBe(0);
  });

  it("never gives a student more than 2, or a staff member more than 5, open loans", async () => {
    const students = await sql`
      select student_id from public.library_loans
      where institution_id = ${institutionId} and returned_on is null and student_id is not null
      group by student_id having count(*) > 2
    `;
    const staff = await sql`
      select staff_id from public.library_loans
      where institution_id = ${institutionId} and returned_on is null and staff_id is not null
      group by staff_id having count(*) > 5
    `;
    expect(students.length).toBe(0);
    expect(staff.length).toBe(0);
  });

  it("guardian.one reads exactly Aarav's and Ananya's open loans, Ananya's overdue", async () => {
    const [aarav] = await sql`
      select s.id from public.students s where s.institution_id = ${institutionId} and s.first_name = 'Aarav' and s.admission_no = 'ADM/2024/00412'
    `;
    const [ananya] = await sql`
      select s.id from public.students s where s.institution_id = ${institutionId} and s.first_name = 'Ananya' and s.admission_no = 'ADM/2020/00133'
    `;

    const client = await signInDemo("guardian.one");
    const { data, error } = await client.from("library_loans").select("student_id, due_on").is("returned_on", null);
    if (error) throw error;

    expect(data).toHaveLength(2);
    const studentIds = (data ?? []).map((r) => r.student_id).sort();
    expect(studentIds).toEqual([aarav.id as string, ananya.id as string].sort());

    const ananyaRow = (data ?? []).find((r) => r.student_id === ananya.id)!;
    expect(new Date(`${ananyaRow.due_on}T00:00:00Z`).getTime()).toBeLessThan(Date.now());
  });

  it("writes zero library_fine invoice_lines", async () => {
    const [row] = await sql`
      select count(*)::int as n from public.invoice_lines
      where institution_id = ${institutionId} and head = 'library_fine'
    `;
    expect(row.n).toBe(0);
  });

  it("settings.modules.library is true on the demo tenant", async () => {
    const [row] = await sql`select settings from public.institutions where id = ${institutionId}`;
    const settings = row.settings as Record<string, unknown>;
    const modules = settings.modules as Record<string, unknown>;
    expect(modules.library).toBe(true);
  });

  it("gives identical book and copy ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.library_books where institution_id = ${institutionId}
      union all
      select id from public.library_copies where institution_id = ${institutionId}
      order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.library_books where institution_id = ${afterInstitutionId}
      union all
      select id from public.library_copies where institution_id = ${afterInstitutionId}
      order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);
  }, 180_000);
});
