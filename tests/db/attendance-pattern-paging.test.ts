import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (same shape as attendance-actions.test.ts) — only this file's
// module graph gets it. Must precede the queries.ts import: vi.mock calls
// are hoisted, but getSectionAttendancePatterns calls createClient() at
// call time, which needs this in place before that call, not before the
// import — hoisting makes the ordering here cosmetic, but it matches the
// rest of the test suite's convention.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { getSectionAttendancePatterns } from "@/modules/attendance/queries";
import type { Database } from "@/lib/db/types";
import { buildContext } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 default statuses — same shape as attendance-actions.test.ts's own
// fixture, needed so `app.validate_attendance_status` accepts 'P'/'A' rows.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

// Fix round 1 (security review, MED-4) — regression coverage for the
// `.range()` paging fix in `getSectionAttendancePatterns`
// (src/modules/attendance/queries.ts). The seeded demo tenant already has
// 1,764 attendance_records for a single section in one term; without
// paging, PostgREST's 1,000-row default page silently dropped the rest, in
// no fixed order, so counts/recent-offsets were wrong.
//
// Lead fix (during pre-commit verification): the first version of this
// fixture used 1,100 SESSIONS for one student to get >1,000 records. That
// also blew up the query's `.in("session_id", sessionIds)` list to 1,100
// UUIDs, which failed with "URI too long" — a real but separate scaling
// question (a term spanning far more school days than any real term ever
// does) that isn't what MED-4 was about and isn't fixed here. Rewritten to
// a realistic term length (150 school days, comfortably under any URL
// limit) with enough enrolled students that total attendance_records
// (150 × 8 = 1,200) still exceeds the 1,000-row page, isolating the actual
// regression: whether every row gets counted, not just the first 1,000.
//
// NOT run by the implementer (not DB owner that round) — run here before
// commit.
describe("getSectionAttendancePatterns paging (MED-4 regression)", () => {
  it("counts every attendance_record for the term, not just the first 1,000", async () => {
    const inst = await createTestInstitution("attendance-pattern-paging");
    await setAttendanceSettings(inst.institutionId);

    const year = await createAcademicYear(inst.institutionId, { startsOn: "2020-01-01", endsOn: "2020-12-31" });
    const term = await createTerm(inst.institutionId, year, {
      name: "Term",
      startsOn: "2020-01-01",
      endsOn: "2020-12-31",
    });
    const grade = await createGrade(inst.institutionId);
    const section = await createClassSection(inst.institutionId, grade, year);

    const totalSessions = 150; // a realistic term length — keeps the session_id IN-list small.
    const studentCount = 8; // 150 * 8 = 1,200 attendance_records > the 1,000-row page.
    const recentAbsentCount = 5; // within the last `RECENT_SCHOOL_DAYS` (10).

    const studentIds: string[] = [];
    for (let i = 0; i < studentCount; i++) {
      const id = await createStudent(inst.institutionId, `ADM-PAGING-${i}`);
      await createEnrolment(inst.institutionId, id, section, year, { rollNo: i + 1 });
      studentIds.push(id);
    }
    const studentId = studentIds[0]!; // the one we assert on; the rest exist only to inflate row count.

    // Bulk-insert distinct-date sessions in one round trip.
    await sql`
      insert into public.attendance_sessions (institution_id, class_section_id, date, status)
      select ${inst.institutionId}, ${section}, (date '2020-01-01' + (n || ' days')::interval)::date, 'submitted'
      from generate_series(0, ${totalSessions - 1}) as n
    `;

    // One record per (session, student) — the most recent `recentAbsentCount`
    // session dates are 'A' for every student, everything else 'P'. Only
    // `studentId`'s pattern is asserted below.
    await sql`
      insert into public.attendance_records (institution_id, session_id, student_id, status)
      select ${inst.institutionId}, s.id, e.student_id,
        case
          when s.date >= (date '2020-01-01' + ((${totalSessions}::int - ${recentAbsentCount}::int) || ' days')::interval)::date
          then 'A' else 'P'
        end
      from public.attendance_sessions s
      cross join public.enrolments e
      where s.class_section_id = ${section} and e.class_section_id = ${section}
    `;

    const ctx = await buildContext(inst, "owner");
    setActingClient(inst.clientAs("owner") as unknown as SupabaseClient<Database>);
    let result;
    try {
      result = await getSectionAttendancePatterns(ctx, section, term);
    } finally {
      setActingClient(null);
    }

    expect(result).not.toBeNull();
    const pattern = result?.students.find((s) => s.studentId === studentId);
    expect(pattern).toBeDefined();

    // The regression this guards: without `.range()` paging, this would be
    // capped at 1,000 total rows across ALL students, and the present/
    // absent split would be wrong for whichever rows PostgREST happened to
    // return first.
    expect(pattern!.presentCount + pattern!.absentCount + pattern!.lateCount).toBe(totalSessions);
    expect(pattern!.absentCount).toBe(recentAbsentCount);
    expect(pattern!.presentCount).toBe(totalSessions - recentAbsentCount);

    // The 5 most recent school days (offsets 0-4 of the last 10) are the
    // absent ones.
    expect(pattern!.recentAbsentDayOffsets).toEqual([0, 1, 2, 3, 4]);
  });
});
