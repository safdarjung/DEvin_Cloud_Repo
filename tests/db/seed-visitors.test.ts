import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";

// X07-T9 (seed section `visitors`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-operations.test.ts); the last test triggers its own
// reseed to check determinism.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

async function signInDemo(loginKey: string) {
  const client = createClient(
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

describe("X07-T9 seed section visitors", () => {
  it("seeds 25 visitor entries, 3 pickup persons, 2 gate passes, all checked out", async () => {
    const [entries] = await sql`
      select count(*)::int as n from public.visitor_entries
      where institution_id = ${institutionId} and checked_out_at is not null
    `;
    expect(entries.n).toBe(25);

    const [pickups] = await sql`select count(*)::int as n from public.pickup_persons where institution_id = ${institutionId}`;
    expect(pickups.n).toBe(3);

    const [passes] = await sql`select count(*)::int as n from public.gate_passes where institution_id = ${institutionId}`;
    expect(passes.n).toBe(2);
  });

  it("the `visitors` module is enabled on the demo tenant", async () => {
    const [row] = await sql`select app.module_enabled(${institutionId}::uuid, 'visitors') as enabled`;
    expect(row.enabled).toBe(true);
  });

  it("guardian.one reads 2 pickup persons for Aarav (RLS)", async () => {
    const client = await signInDemo("guardian.one");
    const [aarav] = await sql`
      select id from public.students where institution_id = ${institutionId} and admission_no = 'ADM/2024/00412'
    `;
    const { data, error } = await client.from("pickup_persons").select("id, full_name, relation").eq("student_id", aarav!.id as string);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(new Set((data ?? []).map((r) => r.relation))).toEqual(new Set(["grandparent", "driver"]));
    await client.auth.signOut();
  });

  it("teacher.vi-a sees the pending gate pass for their section (RLS)", async () => {
    const client = await signInDemo("teacher.vi-a");
    const { data, error } = await client.from("gate_passes").select("id, status").eq("status", "pending");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    await client.auth.signOut();
  });

  it("Ananya's gate pass is exited; Aarav has no open pass", async () => {
    const [ananya] = await sql`
      select id from public.students where institution_id = ${institutionId} and admission_no = 'ADM/2020/00133'
    `;
    const [aarav] = await sql`
      select id from public.students where institution_id = ${institutionId} and admission_no = 'ADM/2024/00412'
    `;
    const ananyaPasses = await sql`select status from public.gate_passes where student_id = ${ananya!.id as string}`;
    expect(ananyaPasses).toHaveLength(1);
    expect(ananyaPasses[0]!.status).toBe("exited");

    const aaravOpen = await sql`
      select id from public.gate_passes where student_id = ${aarav!.id as string} and status in ('pending', 'approved')
    `;
    expect(aaravOpen).toHaveLength(0);
  });

  it("gives identical visitor_entries/pickup_persons/gate_passes ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.visitor_entries where institution_id = ${institutionId}
      union select id from public.pickup_persons where institution_id = ${institutionId}
      union select id from public.gate_passes where institution_id = ${institutionId}
      order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBe(25 + 3 + 2);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.visitor_entries where institution_id = ${afterInstitutionId}
      union select id from public.pickup_persons where institution_id = ${afterInstitutionId}
      union select id from public.gate_passes where institution_id = ${afterInstitutionId}
      order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);

    // Spot check the fixed uuidV5 formula too.
    const expectedEntryId = uuidV5("visitors", "entry:0");
    const [entry] = await sql`
      select 1 as found from public.visitor_entries where id = ${expectedEntryId} and institution_id = ${afterInstitutionId}
    `;
    expect(entry).toBeTruthy();
  }, 180_000);
});
