import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string) {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

describe("migration 0076 part 1: student_lifecycle_events + status guards", () => {
  it("a direct owner update of enrolments.status is blocked (invalid_state)", async () => {
    const inst = await createTestInstitution("lifecycle-enrolment-guard");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const studentId = await insertStudent(inst.institutionId, "ADM-LC1");
      const enrolmentId = await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

      const update = await inst
        .clientAs("owner")
        .from("enrolments")
        .update({ status: "completed" })
        .eq("id", enrolmentId);
      expect(update.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("a direct admin update of students.status is blocked (invalid_state)", async () => {
    const inst = await createTestInstitution("lifecycle-student-guard");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-LC2");
      const update = await inst.clientAs("admin").from("students").update({ status: "withdrawn" }).eq("id", studentId);
      expect(update.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin cannot insert an enrolment that doesn't start active (invalid_state)", async () => {
    const inst = await createTestInstitution("lifecycle-enrolment-insert-guard");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const studentId = await insertStudent(inst.institutionId, "ADM-LC3");

      const insert = await inst.clientAs("admin").from("enrolments").insert({
        institution_id: inst.institutionId,
        student_id: studentId,
        class_section_id: sectionId,
        academic_year_id: yearId,
        started_on: "2026-04-01",
        status: "completed",
      });
      expect(insert.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("a postgres-session status write bypasses the guard (seed path)", async () => {
    const inst = await createTestInstitution("lifecycle-seed-bypass");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const studentId = await insertStudent(inst.institutionId, "ADM-LC4");
      const enrolmentId = await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

      await sql`update public.enrolments set status = 'completed' where id = ${enrolmentId}`;
      await sql`update public.students set status = 'alumni' where id = ${studentId}`;

      const [enrolment] = await sql`select status from public.enrolments where id = ${enrolmentId}`;
      const [student] = await sql`select status from public.students where id = ${studentId}`;
      expect(enrolment.status).toBe("completed");
      expect(student.status).toBe("alumni");
    } finally {
      await inst.cleanup();
    }
  });

  it("authenticated insert into student_lifecycle_events is denied; an existing row cannot be updated or deleted, even as postgres", async () => {
    const inst = await createTestInstitution("lifecycle-events-write-guard");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-LC5");

      const insertAttempt = await inst.clientAs("admin").from("student_lifecycle_events").insert({
        institution_id: inst.institutionId,
        student_id: studentId,
        kind: "withdrawn",
        effective_on: "2026-06-01",
        tc_no: "TC/TEST/00001",
        tc_snapshot: {},
        created_by: inst.users.admin.id,
      });
      expect(insertAttempt.error).not.toBeNull();

      const [event] = await sql`
        insert into public.student_lifecycle_events
          (institution_id, student_id, kind, effective_on, tc_no, tc_snapshot, created_by)
        values
          (${inst.institutionId}, ${studentId}, 'withdrawn', '2026-06-01', 'TC/TEST/00002', '{}', ${inst.users.admin.id})
        returning id
      `;

      await expect(
        sql`update public.student_lifecycle_events set reason = 'x' where id = ${event.id}`,
      ).rejects.toThrow(/invalid_state/);
      await expect(
        sql`delete from public.student_lifecycle_events where id = ${event.id}`,
      ).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian reads own child's event not another family's; teacher of the section reads it, teacher of another section does not; accountant reads it", async () => {
    const inst = await createTestInstitution("lifecycle-events-read-scope");
    try {
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

      const [guardianLink] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      const [ownStudentLink] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
      `;
      await createEnrolment(inst.institutionId, ownStudentLink.student_id, sectionA, yearId, { rollNo: 1 });
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianLink.guardian_id}, ${ownStudentLink.student_id}, 'mother', true)
      `;

      const otherStudentId = await insertStudent(inst.institutionId, "ADM-LC6-OTHER");
      await createEnrolment(inst.institutionId, otherStudentId, sectionB, yearId, { rollNo: 1 });

      const [ownEvent] = await sql`
        insert into public.student_lifecycle_events
          (institution_id, student_id, kind, effective_on, tc_no, tc_snapshot, created_by)
        values
          (${inst.institutionId}, ${ownStudentLink.student_id}, 'withdrawn', '2026-06-01', 'TC/TEST/OWN', '{}', ${inst.users.admin.id})
        returning id
      `;
      const [otherEvent] = await sql`
        insert into public.student_lifecycle_events
          (institution_id, student_id, kind, effective_on, tc_no, tc_snapshot, created_by)
        values
          (${inst.institutionId}, ${otherStudentId}, 'withdrawn', '2026-06-01', 'TC/TEST/OTHER', '{}', ${inst.users.admin.id})
        returning id
      `;

      const guardianRead = await inst.clientAs("guardian").from("student_lifecycle_events").select("id");
      const guardianIds = guardianRead.data?.map((r) => r.id) ?? [];
      expect(guardianIds).toContain(ownEvent.id);
      expect(guardianIds).not.toContain(otherEvent.id);

      const teacherOwn = await inst
        .clientAs("teacher")
        .from("student_lifecycle_events")
        .select("id")
        .eq("id", ownEvent.id);
      expect(teacherOwn.data).toHaveLength(1);

      const teacherOther = await inst
        .clientAs("teacher")
        .from("student_lifecycle_events")
        .select("id")
        .eq("id", otherEvent.id);
      expect(teacherOther.data).toHaveLength(0);

      const accountantRead = await inst
        .clientAs("accountant")
        .from("student_lifecycle_events")
        .select("id")
        .eq("id", otherEvent.id);
      expect(accountantRead.data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });
});
