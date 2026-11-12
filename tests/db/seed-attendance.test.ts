import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";
import { SCHOOL_DAYS } from "../../scripts/seed/sections/attendance.ts";

// Bounded to the seeded window (exported from attendance.ts) so these counts
// don't break once J-06 creates today's live session on top of the seed.
const WINDOW_START = SCHOOL_DAYS[0]!;
const WINDOW_END = SCHOOL_DAYS[SCHOOL_DAYS.length - 1]!;

// T-016 (05 §8 / §8.1, AC1-5). Reads the already-seeded demo tenant — run
// `pnpm demo:reset` before this file (seeding ~181k attendance records is
// too slow to redo per test run; see CLAUDE.md "Run only your packet's
// targeted tests").

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
});

afterAll(async () => {
  await sql.end();
});

describe("T-016 seed counts (AC1)", () => {
  it("produces 4,320 attendance_sessions and 181,440 attendance_records", async () => {
    const [sessions] = await sql`
      select count(*)::int as n from public.attendance_sessions
      where institution_id = ${institutionId} and date between ${WINDOW_START} and ${WINDOW_END}
    `;
    const [records] = await sql`
      select count(*)::int as n from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.institution_id = ${institutionId} and s.date between ${WINDOW_START} and ${WINDOW_END}
    `;
    expect(sessions.n).toBe(4320);
    expect(records.n).toBe(181440);
  });

  it("every seeded attendance_session is submitted with a class teacher marked_by", async () => {
    const [row] = await sql`
      select count(*)::int as n
      from public.attendance_sessions
      where institution_id = ${institutionId} and date between ${WINDOW_START} and ${WINDOW_END}
        and (status <> 'submitted' or marked_by is null)
    `;
    expect(row.n).toBe(0);
  });
});

describe("T-016 absence rate (AC2)", () => {
  it("overall absence rate is between 5.5% and 6.5%", async () => {
    const [row] = await sql`
      select
        count(*) filter (where r.status = 'A')::numeric / count(*)::numeric * 100 as rate
      from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.institution_id = ${institutionId} and s.date between ${WINDOW_START} and ${WINDOW_END}
    `;
    const rate = Number(row.rate);
    expect(rate).toBeGreaterThanOrEqual(5.5);
    expect(rate).toBeLessThanOrEqual(6.5);
  });

  it("every section has at least one absence on the last seeded day", async () => {
    const rows = await sql`
      select s.class_section_id, count(r.id) filter (where r.status = 'A')::int as absences
      from public.attendance_sessions s
      join public.attendance_records r on r.session_id = s.id
      where s.institution_id = ${institutionId} and s.date = ${WINDOW_END}
      group by s.class_section_id
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.absences).toBeGreaterThanOrEqual(1);
  });
});

describe("T-016 named student attendance (05 §8.1)", () => {
  // Scoped by (grade, section, roll_no) — not by name — because the generic
  // roster's random names can coincidentally collide with a named student's
  // full name elsewhere in the 3,024-student demo tenant.
  async function attendancePercent(gradeCode: string, sectionName: string, rollNo: number): Promise<number> {
    const [row] = await sql`
      select
        count(*) filter (where r.status in ('P', 'L'))::numeric / count(*)::numeric * 100 as pct
      from public.enrolments e
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      join public.attendance_records r on r.student_id = e.student_id
      where e.institution_id = ${institutionId} and g.code = ${gradeCode} and cs.name = ${sectionName}
        and e.roll_no = ${rollNo} and e.status = 'active'
    `;
    return Number(row.pct);
  }

  it("Aarav Sharma (VI-A roll 7) is ~92% present", async () => {
    const pct = await attendancePercent("VI", "A", 7);
    expect(pct).toBeGreaterThanOrEqual(91);
    expect(pct).toBeLessThanOrEqual(93);
  });

  it("Ananya Sharma (X-A roll 12) is ~96% present", async () => {
    const pct = await attendancePercent("X", "A", 12);
    expect(pct).toBeGreaterThanOrEqual(95);
    expect(pct).toBeLessThanOrEqual(97);
  });

  it("Ishaan Mehta (VIII-B roll 3) is ~88% present", async () => {
    const pct = await attendancePercent("VIII", "B", 3);
    expect(pct).toBeGreaterThanOrEqual(87);
    expect(pct).toBeLessThanOrEqual(89);
  });
});

describe("T-016 no notification jobs from historical seed data (lead ruling 2)", () => {
  it("zero notify.attendance_absence jobs exist", async () => {
    const [row] = await sql`select count(*)::int as n from public.jobs where type = 'notify.attendance_absence' and institution_id = ${institutionId}`;
    expect(row.n).toBe(0);
  });
});

describe("T-016 determinism (AC3)", () => {
  it("attendance session ids match the deterministic uuidV5(section, date) formula", async () => {
    const sessionId = uuidV5("attendance", `session:VI-A:${WINDOW_START}`);
    const [row] = await sql`
      select 1 as found from public.attendance_sessions where id = ${sessionId} and institution_id = ${institutionId}
    `;
    expect(row).toBeTruthy();
  });

  it("every session has a unique (class_section_id, date) and every record a unique (session_id, student_id)", async () => {
    const [dupSessions] = await sql`
      select count(*)::int as n from (
        select class_section_id, date from public.attendance_sessions
        where institution_id = ${institutionId}
        group by class_section_id, date having count(*) > 1
      ) d
    `;
    const [dupRecords] = await sql`
      select count(*)::int as n from (
        select session_id, student_id from public.attendance_records
        where institution_id = ${institutionId}
        group by session_id, student_id having count(*) > 1
      ) d
    `;
    expect(dupSessions.n).toBe(0);
    expect(dupRecords.n).toBe(0);
  });
});
