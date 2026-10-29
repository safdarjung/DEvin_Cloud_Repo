import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 default `settings.attendance.statuses` — createTestInstitution
// leaves `settings` at its table default ('{}'), so every test that writes
// an attendance_records row sets this first or app.validate_attendance_status
// rejects every status, including the "valid" ones.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present" },
  { code: "A", label: "Absent" },
  { code: "L", label: "Late" },
  { code: "HD", label: "Half day" },
  { code: "OL", label: "On leave" },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  // `jsonb_set` can't create more than one missing intermediate level, and
  // a fresh test institution's `settings` is '{}' — no `attendance` key yet
  // — so merge the whole `attendance` object in with `||` instead.
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
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

describe("attendance migration (0006) RLS", () => {
  it("C-16: teacher of section A can insert a session and records for A but not B", async () => {
    const inst = await createTestInstitution("attendance-c16");
    try {
      await setAttendanceStatuses(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, {
        name: "A",
        classTeacherId: teacherStaff.staff_id,
      });
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });

      const insertA = await inst
        .clientAs("teacher")
        .from("attendance_sessions")
        .insert({ institution_id: inst.institutionId, class_section_id: sectionA, date: "2026-07-01" })
        .select("id")
        .single();
      expect(insertA.error).toBeNull();

      const insertB = await inst
        .clientAs("teacher")
        .from("attendance_sessions")
        .insert({ institution_id: inst.institutionId, class_section_id: sectionB, date: "2026-07-01" });
      expect(insertB.error).not.toBeNull();

      const studentId = await insertStudent(inst.institutionId, "ADM-C16");
      await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { rollNo: 1 });

      const recordForA = await inst.clientAs("teacher").from("attendance_records").insert({
        institution_id: inst.institutionId,
        session_id: insertA.data!.id,
        student_id: studentId,
        status: "P",
      });
      expect(recordForA.error).toBeNull();

      // A session that belongs to B, created directly (bypassing RLS) so the
      // teacher-of-A write path on attendance_records can be probed against it.
      const sessionB = await createAttendanceSession(inst.institutionId, sectionB, { date: "2026-07-02" });
      const recordForB = await inst.clientAs("teacher").from("attendance_records").insert({
        institution_id: inst.institutionId,
        session_id: sessionB,
        student_id: studentId,
        status: "P",
      });
      expect(recordForB.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("status trigger: rejects a status outside the institution's configured set, accepts the default five", async () => {
    const inst = await createTestInstitution("attendance-status");
    try {
      await setAttendanceStatuses(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
      const sessionId = await createAttendanceSession(inst.institutionId, sectionId);
      const invalidStudent = await insertStudent(inst.institutionId, "ADM-STATUS-X");

      await expect(
        sql`
          insert into public.attendance_records (institution_id, session_id, student_id, status)
          values (${inst.institutionId}, ${sessionId}, ${invalidStudent}, 'X')
        `,
      ).rejects.toThrow(/invalid_input/);

      for (const { code } of ATTENDANCE_STATUSES) {
        const studentId = await insertStudent(inst.institutionId, `ADM-STATUS-${code}`);
        const recordId = await createAttendanceRecord(inst.institutionId, sessionId, studentId, { status: code });
        expect(recordId).toBeTypeOf("string");
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("uniqueness: one session per section per day, one record per session per student", async () => {
    const inst = await createTestInstitution("attendance-unique");
    try {
      await setAttendanceStatuses(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
      await createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-01" });

      await expect(
        createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-01" }),
      ).rejects.toThrow();

      const sessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: "2026-07-02" });
      const studentId = await insertStudent(inst.institutionId, "ADM-UNIQUE");
      await createAttendanceRecord(inst.institutionId, sessionId, studentId);

      await expect(createAttendanceRecord(inst.institutionId, sessionId, studentId)).rejects.toThrow();
    } finally {
      await inst.cleanup();
    }
  });

  it("C-15: attendance_corrections is append-only — insert by the class teacher succeeds, UPDATE/DELETE raise", async () => {
    const inst = await createTestInstitution("attendance-c15");
    try {
      await setAttendanceStatuses(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
        classTeacherId: teacherStaff.staff_id,
      });
      const sessionId = await createAttendanceSession(inst.institutionId, sectionId);
      const studentId = await insertStudent(inst.institutionId, "ADM-C15");
      const recordId = await createAttendanceRecord(inst.institutionId, sessionId, studentId, { status: "P" });

      const insertCorrection = await inst
        .clientAs("teacher")
        .from("attendance_corrections")
        .insert({
          institution_id: inst.institutionId,
          record_id: recordId,
          old_status: "P",
          new_status: "A",
          reason: "Marked wrong",
          corrected_by: teacherStaff.staff_id,
        })
        .select("id")
        .single();
      expect(insertCorrection.error).toBeNull();

      await expect(
        sql`update public.attendance_corrections set reason = 'edited' where id = ${insertCorrection.data!.id}`,
      ).rejects.toThrow(/invalid_state/);
      await expect(
        sql`delete from public.attendance_corrections where id = ${insertCorrection.data!.id}`,
      ).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  // CRITICAL (security review): attendance_records insert/update checked only
  // app.teaches_section on the session's section, never that student_id was
  // actually enrolled there — a teacher could write attendance for any
  // student UUID, including another tenant's. Using the owner role below
  // isolates the enrolment check from the teaches_section check.
  it("CRITICAL fix: attendance_records insert requires student_id to be enrolled in the session's section", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      await setAttendanceStatuses(instA.institutionId);
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeA = await createGrade(instA.institutionId);
      const sectionA1 = await createClassSection(instA.institutionId, gradeA, yearA, { name: "A1" });
      const sectionA2 = await createClassSection(instA.institutionId, gradeA, yearA, { name: "A2" });
      const sessionA1 = await createAttendanceSession(instA.institutionId, sectionA1, { date: "2026-07-01" });

      const studentInA1 = await insertStudent(instA.institutionId, "ADM-CRIT-A1");
      await createEnrolment(instA.institutionId, studentInA1, sectionA1, yearA, { rollNo: 1 });

      const studentInA2 = await insertStudent(instA.institutionId, "ADM-CRIT-A2");
      await createEnrolment(instA.institutionId, studentInA2, sectionA2, yearA, { rollNo: 1 });

      const [studentInB] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${instB.institutionId}, 'ADM-CRIT-B', 'Test Student', '2016-01-01', 'other')
        returning id
      `;

      // same-school student, enrolled in a different section → rejected
      const crossSection = await instA.clientAs("owner").from("attendance_records").insert({
        institution_id: instA.institutionId,
        session_id: sessionA1,
        student_id: studentInA2,
        status: "P",
      });
      expect(crossSection.error).not.toBeNull();

      // another tenant's student entirely → rejected
      const crossTenant = await instA.clientAs("owner").from("attendance_records").insert({
        institution_id: instA.institutionId,
        session_id: sessionA1,
        student_id: studentInB.id,
        status: "P",
      });
      expect(crossTenant.error).not.toBeNull();

      // the actually-enrolled student → accepted
      const accepted = await instA.clientAs("owner").from("attendance_records").insert({
        institution_id: instA.institutionId,
        session_id: sessionA1,
        student_id: studentInA1,
        status: "P",
      });
      expect(accepted.error).toBeNull();
    });
  });

  // HIGH (security review): SELECT previously granted every app.staff_roles()
  // member (admissions, accountant, every teacher) instead of the 07 §2.2
  // matrix (full read: owner/principal/admin/exam_controller; teacher scoped
  // to sections they teach; admissions/accountant: none).
  it("HIGH fix: attendance.read is scoped — admissions/accountant see nothing, a teacher sees only sections they teach", async () => {
    const inst = await createTestInstitution("attendance-read-scope");
    try {
      await setAttendanceStatuses(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const [teacherStaff] = await sql`
        select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
      `;
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, {
        name: "A",
        classTeacherId: teacherStaff.staff_id,
      });
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
      const sessionA = await createAttendanceSession(inst.institutionId, sectionA, { date: "2026-07-01" });
      const sessionB = await createAttendanceSession(inst.institutionId, sectionB, { date: "2026-07-01" });

      for (const role of ["admissions", "accountant"] as const) {
        const { data, error } = await inst.clientAs(role).from("attendance_sessions").select("id");
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }

      const teacherVisible = await inst.clientAs("teacher").from("attendance_sessions").select("id");
      const teacherIds = teacherVisible.data?.map((r) => r.id as string) ?? [];
      expect(teacherIds).toContain(sessionA);
      expect(teacherIds).not.toContain(sessionB);

      for (const role of ["owner", "principal", "admin", "exam_controller"] as const) {
        const { data } = await inst.clientAs(role).from("attendance_sessions").select("id");
        const ids = data?.map((r) => r.id as string) ?? [];
        expect(ids).toContain(sessionA);
        expect(ids).toContain(sessionB);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
