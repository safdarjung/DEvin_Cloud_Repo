import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// X06-T10 (seed section `exam_seating`). Reads the already-seeded demo
// tenant — run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check determinism, mirroring tests/db/seed-determinism.test.ts.

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

async function currentPlan(instId: string) {
  const [row] = await sql`
    select p.id, p.seat_count, p.rooms
    from public.exam_seating_plans p
    join public.exams e on e.id = p.exam_id
    where p.institution_id = ${instId} and e.name = 'Unit Test 3' and p.superseded_by is null
  `;
  return row as { id: string; seat_count: number; rooms: { room_id: string; seats: number }[] } | undefined;
}

async function activeStudentCount(instId: string): Promise<number> {
  const [row] = await sql`
    select count(*)::int as n
    from public.enrolments en
    join public.class_sections cs on cs.id = en.class_section_id
    join public.grades g on g.id = cs.grade_id
    join public.students s on s.id = en.student_id
    where en.institution_id = ${instId}
      and en.status = 'active'
      and s.status = 'active'
      and g.code in ('VI', 'VII')
  `;
  return row.n as number;
}

async function seatFingerprint(instId: string): Promise<string> {
  const rows = await sql`
    select es.student_id, es.room_id, es.seat_no
    from public.exam_seats es
    join public.exam_seating_plans p on p.id = es.plan_id
    join public.exams e on e.id = p.exam_id
    where es.institution_id = ${instId} and e.name = 'Unit Test 3' and p.superseded_by is null
    order by es.student_id
  `;
  return rows.map((r) => `${r.student_id}:${r.room_id}:${r.seat_no}`).join("|");
}

describe("X06-T10 seed section exam_seating", () => {
  it("has exactly one current plan for Unit Test 3, seat_count matching active VI/VII students", async () => {
    const plan = await currentPlan(institutionId);
    expect(plan).toBeDefined();
    const expected = await activeStudentCount(institutionId);
    expect(plan!.seat_count).toBe(expected);

    const [{ n: planCount }] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from public.exam_seating_plans p
      join public.exams e on e.id = p.exam_id
      where p.institution_id = ${institutionId} and e.name = 'Unit Test 3' and p.superseded_by is null
    `;
    expect(planCount).toBe(1);
  });

  it("seats the demo guardian's child (Aarav Sharma, VI-A)", async () => {
    const plan = await currentPlan(institutionId);
    const [row] = await sql`
      select es.seat_no
      from public.exam_seats es
      join public.students s on s.id = es.student_id
      where es.institution_id = ${institutionId}
        and es.plan_id = ${plan!.id}
        and s.admission_no = 'ADM/2024/00412'
    `;
    expect(row).toBeDefined();
  });

  it("seats 1 and 2 of the first room are from different grades", async () => {
    const plan = await currentPlan(institutionId);
    const firstRoomId = plan!.rooms[0]!.room_id;
    const rows = await sql`
      select g.code as grade_code
      from public.exam_seats es
      join public.enrolments en on en.student_id = es.student_id and en.status = 'active'
      join public.class_sections cs on cs.id = en.class_section_id
      join public.grades g on g.id = cs.grade_id
      where es.institution_id = ${institutionId}
        and es.plan_id = ${plan!.id}
        and es.room_id = ${firstRoomId}
        and es.seat_no in (1, 2)
      order by es.seat_no
    `;
    expect(rows.length).toBe(2);
    expect(rows[0]!.grade_code).not.toBe(rows[1]!.grade_code);
  });

  it("reseed produces the same (student, room, seat_no) set", async () => {
    const before = await seatFingerprint(institutionId);
    expect(before.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await seatFingerprint(afterInstitutionId);
    expect(after).toBe(before);
  }, 180_000);
});
