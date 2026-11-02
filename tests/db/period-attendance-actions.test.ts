import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern), same as attendance-actions.test.ts.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { markPeriodAttendance } from "@/modules/attendance/actions";
import { getSession, periodSummary } from "@/modules/attendance/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 default statuses (mirrors period-attendance-rls.test.ts).
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

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return student.id as string;
}

async function createOtherTeacher(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher', true)
    returning id
  `;
  return row.id as string;
}

async function createPeriod(institutionId: string, seq: number): Promise<string> {
  const startHour = 8 + seq;
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, ${seq}, ${`Period ${seq}`}, ${`${startHour}:00`}, ${`${startHour}:40`})
    returning id
  `;
  return row.id as string;
}

/** Most recent date (today or earlier, within 7 days) whose ISO weekday is `isodow` — mark_period_attendance rejects future dates. */
function recentDateForIsodow(isodow: number): string {
  const d = new Date();
  const currentIsodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const diff = (currentIsodow - isodow + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

interface Base {
  sectionId: string;
  period1Id: string;
  period2Id: string;
  teacherId: string;
  date: string;
  studentId: string;
}

/** Two periods, a published slot for the teacher at period2 only (period1 has no slot). */
async function buildFixture(inst: TestInstitution): Promise<Base> {
  await setAttendanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectId = await createSubject(inst.institutionId);
  const period1Id = await createPeriod(inst.institutionId, 1);
  const period2Id = await createPeriod(inst.institutionId, 2);
  const [teacherStaff] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  const teacherId = teacherStaff.staff_id as string;
  // RLS (0020: app.my_taught_section_ids) grants session SELECT via a
  // class_teacher/subject_assignments row, not via timetable_slots — the
  // slot alone lets the RPC authorize the write but not read it back.
  await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherId);
  const weekday = 1; // Monday
  const date = recentDateForIsodow(weekday);

  const [version] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${inst.institutionId}, ${yearId}, 'Term Timetable', ${inst.users.admin.id})
    returning id
  `;
  await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
    values (${inst.institutionId}, ${version.id}, ${sectionId}, ${subjectId}, ${teacherId}, ${weekday}, ${period2Id})
  `;
  await sql`
    update public.timetable_versions set status = 'published', published_at = now(), published_by = ${inst.users.admin.id}
    where id = ${version.id}
  `;

  const studentId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

  return { sectionId, period1Id, period2Id, teacherId, date, studentId };
}

describe("M08-T10 attendance.markPeriod action + attendance.periodSummary query", () => {
  it("the slot teacher marks period 2 -> ok, and periodSummary shows counts on period 2 only; daily getSession unaffected", async () => {
    const inst = await createTestInstitution("period-mark-ok");
    try {
      const base = await buildFixture(inst);

      const result = await callAs(inst, "teacher", markPeriodAttendance, {
        classSectionId: base.sectionId,
        periodId: base.period2Id,
        date: base.date,
        records: [{ studentId: base.studentId, status: "P" }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.recordCount).toBe(1);

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      try {
        const summary = await periodSummary(ctx, base.sectionId, base.date);
        expect(summary).toHaveLength(2);
        const p1 = summary.find((p) => p.periodId === base.period1Id);
        const p2 = summary.find((p) => p.periodId === base.period2Id);
        expect(p1?.sessionId).toBeNull();
        expect(p1?.counts).toEqual({});
        expect(p2?.sessionId).toBe(result.data.sessionId);
        expect(p2?.counts).toEqual({ P: 1 });

        const daily = await getSession(ctx, base.sectionId, base.date);
        expect(daily?.session).toBeNull();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("a non-slot teacher is forbidden", async () => {
    const inst = await createTestInstitution("period-mark-forbidden");
    try {
      const base = await buildFixture(inst);
      const other = await createOtherTeacher(inst.institutionId);
      await sql`update public.memberships set staff_id = ${other} where institution_id = ${inst.institutionId} and role = 'exam_controller'`;

      const result = await callAs(inst, "exam_controller", markPeriodAttendance, {
        classSectionId: base.sectionId,
        periodId: base.period2Id,
        date: base.date,
        records: [{ studentId: base.studentId, status: "P" }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("an unknown status code is rejected before the RPC runs", async () => {
    const inst = await createTestInstitution("period-mark-bad-status");
    try {
      const base = await buildFixture(inst);

      const result = await callAs(inst, "teacher", markPeriodAttendance, {
        classSectionId: base.sectionId,
        periodId: base.period2Id,
        date: base.date,
        records: [{ studentId: base.studentId, status: "ZZ" }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });

      const rows = await sql`
        select id from public.attendance_sessions
        where institution_id = ${inst.institutionId} and class_section_id = ${base.sectionId} and date = ${base.date}
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
