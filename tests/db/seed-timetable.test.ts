import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M07-T6 (seed section `timetable`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-people-academics.test.ts); the last test triggers its own
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

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("M07-T6 seed section timetable", () => {
  it("has exactly one published version for the current academic year", async () => {
    const rows = await sql`
      select v.id, v.status from public.timetable_versions v
      where v.institution_id = ${institutionId} and v.status = 'published'
    `;
    expect(rows.length).toBe(1);
  });

  it("fills at least 40 of 42 cells for every one of the 72 sections", async () => {
    const rows = await sql`
      select cs.id as section_id, count(ts.id)::int as filled
      from public.class_sections cs
      left join public.timetable_slots ts
        on ts.class_section_id = cs.id
        and ts.version_id = (select id from public.timetable_versions where institution_id = ${institutionId} and status = 'published')
      where cs.institution_id = ${institutionId}
      group by cs.id
    `;
    expect(rows.length).toBe(72);
    for (const row of rows) {
      expect(row.filled).toBeGreaterThanOrEqual(40);
    }
  });

  it("never double-books a teacher in the same weekday/period", async () => {
    const rows = await sql`
      select version_id, teacher_id, weekday, period_id, count(*)::int as n
      from public.timetable_slots
      where institution_id = ${institutionId}
      group by version_id, teacher_id, weekday, period_id
      having count(*) > 1
    `;
    expect(rows.length).toBe(0);
  });

  it("never double-books a room in the same weekday/period", async () => {
    const rows = await sql`
      select version_id, room_id, weekday, period_id, count(*)::int as n
      from public.timetable_slots
      where institution_id = ${institutionId} and room_id is not null
      group by version_id, room_id, weekday, period_id
      having count(*) > 1
    `;
    expect(rows.length).toBe(0);
  });

  it("gives identical slot ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.timetable_slots where institution_id = ${institutionId} order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.timetable_slots where institution_id = ${afterInstitutionId} order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);
  }, 180_000);
});
