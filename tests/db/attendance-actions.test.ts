import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph
// gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { correctAttendance, markAttendance, submitAttendance } from "@/modules/attendance/actions";
import { getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 default statuses, with 'A' set to notify a guardian — mirrors the
// seeded default exactly (DEFAULT_INSTITUTION_SETTINGS in
// src/modules/core/schemas.ts) so this test exercises the real shape.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
  { code: "L", label: "Late", counts_present: 1, in_denominator: true },
  { code: "HD", label: "Half day", counts_present: 0.5, in_denominator: true },
  { code: "OL", label: "On leave", counts_present: 0, in_denominator: true },
];

async function setAttendanceSettings(institutionId: string, correctionWindowDays = 3): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', ${correctionWindowDays}::int,
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

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in an arbitrary IANA timezone (en-CA formats as YYYY-MM-DD). */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/** Pure calendar-day arithmetic on an ISO date string — not clock arithmetic. */
function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setInstitutionTimezone(institutionId: string, timezone: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('locale', jsonb_build_object('timezone', ${timezone}::text, 'currency', 'INR'))
    where id = ${institutionId}
  `;
}

describe("attendance module (T-015) — markAttendance/submitAttendance/correctAttendance via callAs", () => {
  it("AC1: a teacher may mark only the section they are the class teacher of; another section is forbidden", async () => {
    const inst = await createTestInstitution("attendance-ac1");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionMine = await createClassSection(inst.institutionId, gradeId, yearId, {
        name: "A",
        classTeacherId: teacherStaff.staff_id,
      });
      const sectionOther = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
      const studentId = await insertStudent(inst.institutionId, "ADM-AC1");
      await createEnrolment(inst.institutionId, studentId, sectionOther, yearId, { rollNo: 1 });

      const result = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionOther,
        date: todayIso(),
        records: [{ studentId, status: "P" }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });

      // getTodaySectionsForTeacher only lists the teacher's own class-teacher section.
      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      let sectionIds: string[];
      try {
        sectionIds = (await getTodaySectionsForTeacher(ctx)).map((s) => s.id);
      } finally {
        setActingClient(null);
      }
      expect(sectionIds).toContain(sectionMine);
      expect(sectionIds).not.toContain(sectionOther);
    } finally {
      await inst.cleanup();
    }
  });

  it("AC2/AC3: marking N students and submitting creates one session, N records, and one job per absence; resubmitting is idempotent", async () => {
    const inst = await createTestInstitution("attendance-ac2");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        name: "A",
        classTeacherId: teacherStaff.staff_id,
      });

      const studentCount = 42;
      const absentCount = 5;
      const studentIds: string[] = [];
      for (let i = 0; i < studentCount; i++) {
        const studentId = await insertStudent(inst.institutionId, `ADM-AC2-${i}`);
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: i + 1 });
        studentIds.push(studentId);
      }

      const date = todayIso();
      const marked = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionId,
        date,
        records: studentIds.map((studentId, i) => ({ studentId, status: i < absentCount ? "A" : "P" })),
      });
      expect(marked.ok).toBe(true);
      if (!marked.ok) return;
      expect(marked.data.recordCount).toBe(studentCount);

      const submitted = await callAs(inst, "teacher", submitAttendance, { sessionId: marked.data.sessionId });
      expect(submitted).toMatchObject({ ok: true, data: { status: "submitted" } });

      const [sessionCount] = await sql`
        select count(*)::int as count from public.attendance_sessions where institution_id = ${inst.institutionId}
      `;
      expect(sessionCount.count).toBe(1);

      const [recordCount] = await sql`
        select count(*)::int as count from public.attendance_records where institution_id = ${inst.institutionId}
      `;
      expect(recordCount.count).toBe(studentCount);

      const [jobCount] = await sql`
        select count(*)::int as count from public.jobs
        where institution_id = ${inst.institutionId} and type = 'notify.attendance_absence'
      `;
      expect(jobCount.count).toBe(absentCount);

      const auditRows = await sql`
        select action, before, after, metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'attendance.submitted'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].before).toEqual({ status: "open" });
      expect(auditRows[0].after).toEqual({ status: "submitted" });
      expect(auditRows[0].metadata).toEqual({ record_count: studentCount, notified_count: absentCount });

      // Resubmitting: no-op success, no duplicate rows or jobs (AC3).
      const resubmitted = await callAs(inst, "teacher", submitAttendance, { sessionId: marked.data.sessionId });
      expect(resubmitted).toMatchObject({ ok: true, data: { status: "submitted" } });

      const [sessionCountAfter] = await sql`
        select count(*)::int as count from public.attendance_sessions where institution_id = ${inst.institutionId}
      `;
      expect(sessionCountAfter.count).toBe(1);

      const [jobCountAfter] = await sql`
        select count(*)::int as count from public.jobs
        where institution_id = ${inst.institutionId} and type = 'notify.attendance_absence'
      `;
      expect(jobCountAfter.count).toBe(absentCount);

      const auditRowsAfter = await sql`
        select id from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'attendance.submitted'
      `;
      expect(auditRowsAfter).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("marking a submitted session directly returns invalid_state (not a silent overwrite)", async () => {
    const inst = await createTestInstitution("attendance-mark-submitted");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const studentId = await insertStudent(inst.institutionId, "ADM-MARK-SUBMITTED");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });
      const date = todayIso();

      const marked = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionId,
        date,
        records: [{ studentId, status: "P" }],
      });
      expect(marked.ok).toBe(true);
      if (!marked.ok) return;
      const submitted = await callAs(inst, "teacher", submitAttendance, { sessionId: marked.data.sessionId });
      expect(submitted.ok).toBe(true);

      const remark = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionId,
        date,
        records: [{ studentId, status: "A" }],
      });
      expect(remark).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("AC4a: a class teacher corrects within the correction window", async () => {
    const inst = await createTestInstitution("attendance-ac4a");
    try {
      await setAttendanceSettings(inst.institutionId, 3);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const sessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: todayIso() });
      const studentId = await insertStudent(inst.institutionId, "ADM-AC4A");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });
      const recordId = await createAttendanceRecord(inst.institutionId, sessionId, studentId, { status: "A" });

      const result = await callAs(inst, "teacher", correctAttendance, {
        recordId,
        newStatus: "OL",
        reason: "Marked wrong — was on leave",
      });
      expect(result).toMatchObject({ ok: true, data: { status: "OL" } });

      const corrections = await sql`select old_status, new_status, reason from public.attendance_corrections where record_id = ${recordId}`;
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({ old_status: "A", new_status: "OL" });

      const auditRows = await sql`
        select before, after from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'attendance.corrected' and entity_id = ${recordId}
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].before).toEqual({ status: "A" });
      expect(auditRows[0].after).toEqual({ status: "OL" });
    } finally {
      await inst.cleanup();
    }
  });

  it("AC4b: a class teacher outside the correction window is forbidden; an admin may correct at any time", async () => {
    const inst = await createTestInstitution("attendance-ac4b");
    try {
      await setAttendanceSettings(inst.institutionId, 3);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const sessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: daysAgoIso(10) });
      const studentId = await insertStudent(inst.institutionId, "ADM-AC4B");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });
      const recordId = await createAttendanceRecord(inst.institutionId, sessionId, studentId, { status: "A" });

      const asTeacher = await callAs(inst, "teacher", correctAttendance, {
        recordId,
        newStatus: "OL",
        reason: "Outside window",
      });
      expect(asTeacher).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const asAdmin = await callAs(inst, "admin", correctAttendance, {
        recordId,
        newStatus: "OL",
        reason: "Admin correction outside window",
      });
      expect(asAdmin).toMatchObject({ ok: true, data: { status: "OL" } });

      const corrections = await sql`select id from public.attendance_corrections where record_id = ${recordId}`;
      expect(corrections).toHaveLength(1);

      const auditRows = await sql`
        select id from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'attendance.corrected' and entity_id = ${recordId}
      `;
      expect(auditRows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  // Security review fix: the window boundary must use the INSTITUTION's
  // local date (settings.locale.timezone), not the DB session's UTC date
  // (`current_date`) — from IST 00:00-05:29 those differ by a day, silently
  // extending a teacher's window. Asia/Kolkata is only 5.5h off UTC, so a
  // stale-UTC bug there is hard to hit reliably in a test; Pacific/Kiritimati
  // (UTC+14, no DST) is far enough from UTC that its local calendar date
  // differs from the UTC date for most of every UTC day, so this boundary
  // would misfire under the old `current_date` code far more often than it
  // would happen to agree by chance. `now()` itself is never mocked — both
  // the SQL fix and this assertion independently read the real clock through
  // the same `(... at time zone tz)::date` formula.
  it("security fix: the correction window boundary uses the institution's local timezone, not UTC", async () => {
    const inst = await createTestInstitution("attendance-tz-fix");
    try {
      const timezone = "Pacific/Kiritimati";
      await setAttendanceSettings(inst.institutionId, 3);
      await setInstitutionTimezone(inst.institutionId, timezone);
      const localToday = todayInTimezone(timezone);

      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });

      // Exactly at the window edge (local today - 3 days): within window.
      const edgeSessionId = await createAttendanceSession(inst.institutionId, sectionId, {
        date: addDaysToIso(localToday, -3),
      });
      const edgeStudentId = await insertStudent(inst.institutionId, "ADM-TZ-EDGE");
      await createEnrolment(inst.institutionId, edgeStudentId, sectionId, yearId, { rollNo: 1 });
      const edgeRecordId = await createAttendanceRecord(inst.institutionId, edgeSessionId, edgeStudentId, { status: "A" });

      const atEdge = await callAs(inst, "teacher", correctAttendance, {
        recordId: edgeRecordId,
        newStatus: "OL",
        reason: "Within window (local date)",
      });
      expect(atEdge).toMatchObject({ ok: true, data: { status: "OL" } });

      // One day further back (local today - 4 days): outside window.
      const outsideSessionId = await createAttendanceSession(inst.institutionId, sectionId, {
        date: addDaysToIso(localToday, -4),
      });
      const outsideStudentId = await insertStudent(inst.institutionId, "ADM-TZ-OUTSIDE");
      await createEnrolment(inst.institutionId, outsideStudentId, sectionId, yearId, { rollNo: 2 });
      const outsideRecordId = await createAttendanceRecord(inst.institutionId, outsideSessionId, outsideStudentId, {
        status: "A",
      });

      const pastEdge = await callAs(inst, "teacher", correctAttendance, {
        recordId: outsideRecordId,
        newStatus: "OL",
        reason: "Outside window (local date)",
      });
      expect(pastEdge).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("correctAttendance rejects an empty reason (validation_failed) and an unknown record (not_found)", async () => {
    const inst = await createTestInstitution("attendance-correct-validation");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const sessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: todayIso() });
      const studentId = await insertStudent(inst.institutionId, "ADM-VALIDATION");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });
      const recordId = await createAttendanceRecord(inst.institutionId, sessionId, studentId, { status: "A" });

      const emptyReason = await callAs(inst, "teacher", correctAttendance, {
        recordId,
        newStatus: "OL",
        reason: " ",
      });
      expect(emptyReason).toMatchObject({ ok: false, error: { code: "validation_failed" } });

      const unknownRecord = await callAs(inst, "teacher", correctAttendance, {
        recordId: "00000000-0000-0000-0000-000000000000",
        newStatus: "OL",
        reason: "Does not matter",
      });
      expect(unknownRecord).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("markAttendance rejects a future date and a status not configured for this institution", async () => {
    const inst = await createTestInstitution("attendance-mark-validation");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const studentId = await insertStudent(inst.institutionId, "ADM-FUTURE");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 2);
      const futureDate = future.toISOString().slice(0, 10);

      const futureResult = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionId,
        date: futureDate,
        records: [{ studentId, status: "P" }],
      });
      expect(futureResult).toMatchObject({ ok: false, error: { code: "validation_failed" } });

      const badStatus = await callAs(inst, "teacher", markAttendance, {
        classSectionId: sectionId,
        date: todayIso(),
        records: [{ studentId, status: "Z" }],
      });
      expect(badStatus).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("an accountant is forbidden from marking attendance (no attendance.mark)", async () => {
    const inst = await createTestInstitution("attendance-accountant-forbidden");
    try {
      await setAttendanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
      const studentId = await insertStudent(inst.institutionId, "ADM-ACCOUNTANT");
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

      const result = await callAs(inst, "accountant", markAttendance, {
        classSectionId: sectionId,
        date: todayIso(),
        records: [{ studentId, status: "P" }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });
});
