import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Mirrors DEFAULT_INSTITUTION_SETTINGS (src/modules/core/schemas.ts) so
// app.validate_attendance_status accepts 'P'/'A'.
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

async function createOtherTeacher(institutionId: string, name = "Other Teacher"): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${name}, 'teacher', true)
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

async function createDraftVersion(institutionId: string, academicYearId: string, createdBy: string): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${institutionId}, ${academicYearId}, 'Term Timetable', ${createdBy})
    returning id
  `;
  return row.id as string;
}

async function publishVersion(institutionId: string, versionId: string, adminUserId: string): Promise<void> {
  await sql`
    update public.timetable_versions set status = 'published', published_at = now(), published_by = ${adminUserId}
    where id = ${versionId}
  `;
}

/** Institution-local "today" (Asia/Kolkata, the test default) as YYYY-MM-DD — anchoring on bare `new Date()` (server/UTC date) drifts a day off near IST midnight, since assign_substitution/mark_period_attendance compare p_date against `now() at time zone v_timezone`. */
function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Next date (today or later) whose ISO weekday (1=Mon..6=Sat) is `isodow` — for the future-date test (mirrors substitutions-rls.test.ts). */
function nextDateForIsodow(isodow: number, minDaysAhead = 3): string {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  const currentIsodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const diff = (isodow - currentIsodow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

interface Base {
  yearId: string;
  sectionId: string;
  periodId: string;
  teacherId: string;
  versionId: string;
  slotId: string;
  weekday: number;
  date: string;
  studentId: string;
}

async function buildPublishedSlotWithStudent(inst: TestInstitution): Promise<Base> {
  await setAttendanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectId = await createSubject(inst.institutionId);
  const periodId = await createPeriod(inst.institutionId, 1);
  const [teacherStaff] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  const teacherId = teacherStaff.staff_id as string;
  const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
  // Slot's weekday must equal institution-local "today": mark_period_attendance
  // rejects p_date > today, assign_substitution rejects p_date < today, so the
  // only date satisfying both is today itself — hardcoding weekday=1 (Monday)
  // and picking the most recent Monday only worked by accident on Mondays.
  const date = localToday();
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

  const [slot] = await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
    values (${inst.institutionId}, ${versionId}, ${sectionId}, ${subjectId}, ${teacherId}, ${weekday}, ${periodId})
    returning id
  `;
  await publishVersion(inst.institutionId, versionId, inst.users.admin.id);

  const studentId = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });

  return { yearId, sectionId, periodId, teacherId, versionId, slotId: slot.id as string, weekday, date, studentId };
}

describe("staffing migration (0070 part 3) — attendance_sessions.period_id + mark_period_attendance", () => {
  it("a daily and a period session coexist for the same section+date", async () => {
    const inst = await createTestInstitution("period-coexist");
    try {
      const base = await buildPublishedSlotWithStudent(inst);

      const [daily] = await sql`
        insert into public.attendance_sessions (institution_id, class_section_id, date, status)
        values (${inst.institutionId}, ${base.sectionId}, ${base.date}, 'open')
        returning id, period_id
      `;
      expect(daily.period_id).toBeNull();

      const { data, error } = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(error).toBeNull();
      expect(data.period_id).toBe(base.periodId);
      expect(data.status).toBe("submitted");

      const rows = await sql`
        select id from public.attendance_sessions
        where institution_id = ${inst.institutionId} and class_section_id = ${base.sectionId} and date = ${base.date}
      `;
      expect(rows).toHaveLength(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("direct insert of a session with a non-null period_id is rejected", async () => {
    const inst = await createTestInstitution("period-direct-insert");
    try {
      const base = await buildPublishedSlotWithStudent(inst);
      // Via the authenticated-role client (real RLS + guard), not the admin
      // SQL connection: the guard's own `session_user = 'postgres'` bypass
      // (lesson 5) would otherwise let this insert straight through.
      const { error } = await inst.clientAs("admin").from("attendance_sessions").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        date: base.date,
        period_id: base.periodId,
        status: "open",
      });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("the slot teacher marks via RPC -> submitted session with records; another teacher is forbidden", async () => {
    const inst = await createTestInstitution("period-teacher-scope");
    try {
      const base = await buildPublishedSlotWithStudent(inst);

      const other = await createOtherTeacher(inst.institutionId);
      await sql`update public.memberships set staff_id = ${other} where institution_id = ${inst.institutionId} and role = 'exam_controller'`;

      const forbidden = await inst.clientAs("exam_controller").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(forbidden.error?.message).toContain("code:forbidden");

      const ok = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "A" }],
      });
      expect(ok.error).toBeNull();

      const records = await sql`select status from public.attendance_records where session_id = ${ok.data.id}`;
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe("A");

      const jobs = await sql`select id from public.jobs where type = 'notify.attendance_absence' and institution_id = ${inst.institutionId}`;
      expect(jobs).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("with a substitution assigned, the substitute can mark and the original teacher cannot", async () => {
    const inst = await createTestInstitution("period-substitute-scope");
    try {
      const base = await buildPublishedSlotWithStudent(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      await sql`update public.memberships set staff_id = ${substituteId} where institution_id = ${inst.institutionId} and role = 'exam_controller'`;

      await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });

      const originalBlocked = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(originalBlocked.error?.message).toContain("code:forbidden");

      const substituteOk = await inst.clientAs("exam_controller").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(substituteOk.error).toBeNull();
      expect(substituteOk.data.status).toBe("submitted");
    } finally {
      await inst.cleanup();
    }
  });

  it("a weekday/period with no published slot -> not_found", async () => {
    const inst = await createTestInstitution("period-no-slot");
    try {
      const base = await buildPublishedSlotWithStudent(inst);
      const otherPeriodId = await createPeriod(inst.institutionId, 2);

      const { error } = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: otherPeriodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(error?.message).toContain("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("future date -> validation_failed", async () => {
    const inst = await createTestInstitution("period-future-date");
    try {
      const base = await buildPublishedSlotWithStudent(inst);
      const futureDate = nextDateForIsodow(base.weekday, 365);

      const { error } = await inst.clientAs("admin").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: futureDate,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a second mark for the same section/date/period -> invalid_state", async () => {
    const inst = await createTestInstitution("period-second-mark");
    try {
      const base = await buildPublishedSlotWithStudent(inst);

      const first = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "P" }],
      });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("app.term_attendance_percentage (SQL) ignores period records", async () => {
    const inst = await createTestInstitution("period-term-pct");
    try {
      const base = await buildPublishedSlotWithStudent(inst);
      const termId = await sql`
        insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
        values (${inst.institutionId}, ${base.yearId}, 'Term 1', 1, '2026-04-01', '2027-03-31')
        returning id
      `.then((rows) => rows[0].id as string);

      // Period record: absent. If it leaked into the daily %, this would
      // drag it below 100.
      const mark = await inst.clientAs("teacher").rpc("mark_period_attendance", {
        p_institution_id: inst.institutionId,
        p_class_section_id: base.sectionId,
        p_period_id: base.periodId,
        p_date: base.date,
        p_records: [{ student_id: base.studentId, status: "A" }],
      });
      expect(mark.error).toBeNull();

      // Daily record: present (the only one that should count).
      const [dailySession] = await sql`
        insert into public.attendance_sessions (institution_id, class_section_id, date, status)
        values (${inst.institutionId}, ${base.sectionId}, ${base.date}, 'open')
        returning id
      `;
      await sql`
        insert into public.attendance_records (institution_id, session_id, student_id, status)
        values (${inst.institutionId}, ${dailySession.id}, ${base.studentId}, 'P')
      `;

      const [pct] = await sql`
        select app.term_attendance_percentage(${inst.institutionId}, ${base.studentId}, ${termId}) as pct
      `;
      expect(Number(pct.pct)).toBe(100);
    } finally {
      await inst.cleanup();
    }
  });
});
