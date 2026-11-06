import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// X08-T10 (seed section `ptm`). Reads the already-seeded demo tenant (same
// convention as tests/db/seed-timetable.test.ts) — run `pnpm demo:reset`
// before this file; the last test triggers its own reseed to check
// determinism, mirroring tests/db/seed-determinism.test.ts.

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

async function eventId(): Promise<string> {
  const [row] = await sql`
    select id from public.ptm_events where institution_id = ${institutionId} and title = 'Term 2 PTM'
  `;
  if (!row) throw new Error("Term 2 PTM event not found");
  return row.id as string;
}

async function studentIdFor(firstName: string, lastName: string, gradeCode: string, sectionName: string): Promise<string> {
  const [row] = await sql`
    select s.id
    from public.students s
    join public.enrolments e on e.student_id = s.id and e.status = 'active'
    join public.class_sections cs on cs.id = e.class_section_id
    join public.grades g on g.id = cs.grade_id
    where s.institution_id = ${institutionId} and s.first_name = ${firstName} and s.last_name = ${lastName}
      and g.code = ${gradeCode} and cs.name = ${sectionName}
  `;
  if (!row) throw new Error(`student ${firstName} ${lastName} (${gradeCode}-${sectionName}) not found`);
  return row.id as string;
}

async function teacherStaffIdFor(email: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships
    where institution_id = ${institutionId} and role = 'teacher'
      and user_id = (select id from auth.users where email = ${email})
  `;
  if (!row) throw new Error(`teacher staff id for ${email} not found`);
  return row.staff_id as string;
}

describe("X08-T10 seed section ptm", () => {
  it("has a published Term 2 PTM event on 2026-11-21 with at least 30 sections", async () => {
    const [event] = await sql`
      select id, status, event_date::text as event_date
      from public.ptm_events where institution_id = ${institutionId} and title = 'Term 2 PTM'
    `;
    expect(event).toBeTruthy();
    expect(event.status).toBe("published");
    expect(event.event_date).toBe("2026-11-21");

    const [{ n }] = await sql`select count(*)::int as n from public.ptm_event_sections where event_id = ${event.id}`;
    expect(n).toBeGreaterThanOrEqual(30);
  });

  it("books Aarav with teacher.vi-a at the 10:00 slot (seq 6), and leaves Ananya unbooked", async () => {
    const id = await eventId();
    const aaravId = await studentIdFor("Aarav", "Sharma", "VI", "A");
    const ananyaId = await studentIdFor("Ananya", "Sharma", "X", "A");
    const teacherViAStaffId = await teacherStaffIdFor("teacher.vi-a@demo.coolskool.test");

    const aaravBookings = await sql`
      select b.staff_id, sl.seq
      from public.ptm_bookings b
      join public.ptm_slots sl on sl.id = b.slot_id
      where b.event_id = ${id} and b.student_id = ${aaravId} and b.status = 'booked'
    `;
    expect(aaravBookings.length).toBe(1);
    expect(aaravBookings[0]!.staff_id).toBe(teacherViAStaffId);
    expect(aaravBookings[0]!.seq).toBe(6);

    const ananyaBookings = await sql`
      select 1 from public.ptm_bookings where event_id = ${id} and student_id = ${ananyaId} and status = 'booked'
    `;
    expect(ananyaBookings.length).toBe(0);
  });

  it("leaves Ishaan unbooked and never double-books a slot", async () => {
    const id = await eventId();
    const ishaanId = await studentIdFor("Ishaan", "Mehta", "VIII", "B");

    const ishaanBookings = await sql`
      select 1 from public.ptm_bookings where event_id = ${id} and student_id = ${ishaanId} and status = 'booked'
    `;
    expect(ishaanBookings.length).toBe(0);

    const doubleBooked = await sql`
      select slot_id, count(*)::int as n from public.ptm_bookings
      where event_id = ${id} and status = 'booked'
      group by slot_id having count(*) > 1
    `;
    expect(doubleBooked.length).toBe(0);
  });

  it("has an open, anonymous Term 1 parent feedback survey with 60 unsuppressed responses", async () => {
    const [survey] = await sql`
      select id, status, is_anonymous from public.surveys
      where institution_id = ${institutionId} and title = 'Term 1 parent feedback'
    `;
    expect(survey).toBeTruthy();
    expect(survey.status).toBe("open");
    expect(survey.is_anonymous).toBe(true);

    const [{ n: responseCount }] = await sql`
      select count(*)::int as n from public.survey_responses where survey_id = ${survey.id}
    `;
    expect(responseCount).toBe(60);
    // app.survey_results suppresses anonymous results only below 3 responses.
    expect(responseCount).toBeGreaterThanOrEqual(3);

    const [{ n: respondentCount }] = await sql`
      select count(*)::int as n from public.survey_respondents where survey_id = ${survey.id}
    `;
    expect(respondentCount).toBe(60);
  });

  it("reseed gives identical event/slot/booking/survey ids", async () => {
    const snapshot = async () => {
      const id = await eventId();
      const slots = await sql`select id from public.ptm_slots where event_id = ${id} order by id`;
      const bookings = await sql`select id from public.ptm_bookings where event_id = ${id} order by id`;
      const [survey] = await sql`
        select id from public.surveys where institution_id = ${institutionId} and title = 'Term 1 parent feedback'
      `;
      return {
        eventId: id,
        slotIds: slots.map((r) => r.id as string),
        bookingIds: bookings.map((r) => r.id as string),
        surveyId: survey!.id as string,
      };
    };

    const before = await snapshot();
    expect(before.slotIds.length).toBeGreaterThan(0);
    expect(before.bookingIds.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    institutionId = row!.id as string;
    const after = await snapshot();
    expect(after).toEqual(before);
  }, 180_000);
});
