import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// X02-T11 (seed section `certificates`). Reads the already-seeded demo
// tenant — run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own
// reseed to check determinism, mirroring tests/db/seed-determinism.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

async function certificateTriples(institutionId: string): Promise<[string, string, string][]> {
  const rows = await sql`
    select s.first_name || ' ' || s.last_name as student_name, c.kind, c.serial_no
    from public.certificates c
    join public.students s on s.id = c.student_id
    where c.institution_id = ${institutionId}
    order by c.serial_no
  `;
  return rows.map((r) => [r.student_name as string, r.kind as string, r.serial_no as string]);
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

describe("X02-T11 seed section certificates", () => {
  it("has exactly the 3 named certificates with the expected serials", async () => {
    const year = new Date().getFullYear();
    const triples = await certificateTriples(institutionId);
    expect(triples).toEqual([
      ["Aarav Sharma", "bonafide", `BON/${year}/00001`],
      ["Ananya Sharma", "bonafide", `BON/${year}/00002`],
      ["Ananya Sharma", "character", `CHR/${year}/00001`],
    ]);
  });

  it("has no transfer certificate (no exited student in the seed)", async () => {
    const [row] = await sql`
      select count(*)::int as n from public.certificates where institution_id = ${institutionId} and kind = 'transfer'
    `;
    expect(row!.n).toBe(0);
  });

  it("gives the same (student, kind, serial) triples across a reset + reseed", async () => {
    const before = await certificateTriples(institutionId);
    expect(before.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await certificateTriples(afterInstitutionId);
    expect(after).toEqual(before);
  }, 180_000);
});
