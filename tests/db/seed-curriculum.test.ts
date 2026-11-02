import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M10-T5 (seed section `curriculum`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check determinism.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
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

describe("M10-T5 seed section curriculum", () => {
  it("every section has at least one coverage row", async () => {
    const rows = await sql`
      select cs.id, count(cuc.id)::int as n
      from public.class_sections cs
      left join public.curriculum_unit_coverage cuc on cuc.class_section_id = cs.id
      where cs.institution_id = ${institutionId}
      group by cs.id
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.n).toBeGreaterThanOrEqual(1);
    }
  });

  it("X-A Mathematics has units 1-2 covered, unit 3 planned but not covered", async () => {
    const [unit3] = await sql`
      select cu.id, cu.sequence
      from public.curriculum_units cu
      join public.grades g on g.id = cu.grade_id
      join public.subjects s on s.id = cu.subject_id
      where cu.institution_id = ${institutionId} and g.code = 'X' and s.code = 'MATH' and cu.sequence = 3
    `;
    expect(unit3).toBeTruthy();

    const [section] = await sql`
      select cs.id from public.class_sections cs
      join public.grades g on g.id = cs.grade_id
      where cs.institution_id = ${institutionId} and g.code = 'X' and cs.name = 'A'
    `;
    expect(section).toBeTruthy();

    const covered = await sql`
      select cu.sequence from public.curriculum_unit_coverage cuc
      join public.curriculum_units cu on cu.id = cuc.curriculum_unit_id
      where cuc.class_section_id = ${section!.id} and cu.subject_id = (
        select id from public.subjects where institution_id = ${institutionId} and code = 'MATH'
      )
      order by cu.sequence
    `;
    expect(covered.map((r) => r.sequence)).toEqual([1, 2]);

    const [plan3] = await sql`
      select id from public.lesson_plans where class_section_id = ${section!.id} and curriculum_unit_id = ${unit3!.id}
    `;
    expect(plan3).toBeTruthy();
  });

  it("every coverage row's unit matches its section's grade and subject", async () => {
    const mismatches = await sql`
      select cuc.id
      from public.curriculum_unit_coverage cuc
      join public.class_sections cs on cs.id = cuc.class_section_id
      join public.curriculum_units cu on cu.id = cuc.curriculum_unit_id
      where cuc.institution_id = ${institutionId}
        and (cu.grade_id is distinct from cs.grade_id or cu.subject_id is distinct from cuc.subject_id)
    `;
    expect(mismatches.length).toBe(0);
  });

  it("gives identical lesson_plan and coverage ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.lesson_plans where institution_id = ${institutionId}
      union all
      select id from public.curriculum_unit_coverage where institution_id = ${institutionId}
      order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.lesson_plans where institution_id = ${afterInstitutionId}
      union all
      select id from public.curriculum_unit_coverage where institution_id = ${afterInstitutionId}
      order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);
  }, 180_000);
});
