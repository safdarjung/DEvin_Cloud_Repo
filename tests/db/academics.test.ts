import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  closeFactoriesHelper,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teachesSectionAs(userId: string, institutionId: string, classSectionId: string) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    const [row] = await tx`select app.teaches_section(${institutionId}::uuid, ${classSectionId}::uuid) as result`;
    return row.result as boolean;
  });
}

describe("academics migration (0005) RLS", () => {
  it("C-13: duplicate enrolment per year and duplicate roll number per section both fail; status change writes history", async () => {
    const inst = await createTestInstitution("academics-c13");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });

      const [student] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-C13', 'C13 Student', '2016-01-01', 'other')
        returning id
      `;

      const enrolmentId = await createEnrolment(inst.institutionId, student.id, sectionId, yearId, {
        rollNo: 1,
      });

      // duplicate active enrolment for the same student + year
      await expect(
        createEnrolment(inst.institutionId, student.id, sectionId, yearId, { rollNo: 2 }),
      ).rejects.toThrow();

      // duplicate roll number within the same section (different student)
      const [student2] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-C13B', 'C13 Student B', '2016-01-01', 'other')
        returning id
      `;
      await expect(
        createEnrolment(inst.institutionId, student2.id, sectionId, yearId, { rollNo: 1 }),
      ).rejects.toThrow();

      // M14-T2: direct status writes are now blocked by
      // app.guard_enrolment_status — status only changes through the 0076
      // lifecycle functions. The history-row assertion (from/to/changed_by)
      // moved to T4, exercised through `exit_student`.
      const update = await inst
        .clientAs("owner")
        .from("enrolments")
        .update({ status: "transferred" })
        .eq("id", enrolmentId);
      expect(update.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("AC4: app.teaches_section is true for the class teacher and for a subject-assigned teacher, false otherwise", async () => {
    const inst = await createTestInstitution("academics-ac4");
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
      const subjectId = await createSubject(inst.institutionId);

      expect(await teachesSectionAs(inst.users.teacher.id, inst.institutionId, sectionA)).toBe(true);
      expect(await teachesSectionAs(inst.users.teacher.id, inst.institutionId, sectionB)).toBe(false);

      await createSubjectAssignment(inst.institutionId, sectionB, subjectId, teacherStaff.staff_id);
      expect(await teachesSectionAs(inst.users.teacher.id, inst.institutionId, sectionB)).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("AC3: the class teacher can insert an assignment for their own section but not another, and a guardian sees only published ones", async () => {
    const inst = await createTestInstitution("academics-ac3");
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
      const subjectId = await createSubject(inst.institutionId);

      const insertForA = await inst
        .clientAs("teacher")
        .from("assignments")
        .insert({
          institution_id: inst.institutionId,
          class_section_id: sectionA,
          subject_id: subjectId,
          title: "Homework 1",
          created_by: teacherStaff.staff_id,
          status: "draft",
        })
        .select("id")
        .single();
      expect(insertForA.error).toBeNull();

      const insertForB = await inst.clientAs("teacher").from("assignments").insert({
        institution_id: inst.institutionId,
        class_section_id: sectionB,
        subject_id: subjectId,
        title: "Homework 2",
        created_by: teacherStaff.staff_id,
        status: "draft",
      });
      expect(insertForB.error).not.toBeNull();

      // Guardian/student fixture linked into section A.
      const [guardianLink] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      const [studentLink] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
      `;
      await createEnrolment(inst.institutionId, studentLink.student_id, sectionA, yearId, { rollNo: 1 });
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianLink.guardian_id}, ${studentLink.student_id}, 'mother', true)
      `;

      const [publishedAssignment] = await sql`
        insert into public.assignments (institution_id, class_section_id, subject_id, title, created_by, status)
        values (${inst.institutionId}, ${sectionA}, ${subjectId}, 'Published HW', ${teacherStaff.staff_id}, 'published')
        returning id
      `;

      const guardianVisible = await inst.clientAs("guardian").from("assignments").select("id, status");
      const visibleIds = guardianVisible.data?.map((r) => r.id) ?? [];
      expect(visibleIds).toContain(publishedAssignment.id);
      expect(visibleIds).not.toContain(insertForA.data!.id); // draft — never visible to guardians
    } finally {
      await inst.cleanup();
    }
  });

  it("AC5: a teacher reads guardians of students in their own sections, and not others", async () => {
    const inst = await createTestInstitution("academics-ac5");
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

      const [ownStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-AC5-OWN', 'Own Student', '2016-01-01', 'other')
        returning id
      `;
      const [ownGuardian] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Own Guardian', '9444444444')
        returning id
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${ownGuardian.id}, ${ownStudent.id}, 'mother', true)
      `;
      await createEnrolment(inst.institutionId, ownStudent.id, sectionA, yearId, { rollNo: 1 });

      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-AC5-OTHER', 'Other Student', '2016-01-01', 'other')
        returning id
      `;
      const [otherGuardian] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${inst.institutionId}, 'Other Guardian', '9555555555')
        returning id
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${otherGuardian.id}, ${otherStudent.id}, 'mother', true)
      `;
      await createEnrolment(inst.institutionId, otherStudent.id, sectionB, yearId, { rollNo: 1 });

      const ownVisible = await inst.clientAs("teacher").from("guardians").select("id").eq("id", ownGuardian.id);
      expect(ownVisible.data).toHaveLength(1);

      const otherVisible = await inst
        .clientAs("teacher")
        .from("guardians")
        .select("id")
        .eq("id", otherGuardian.id);
      expect(otherVisible.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
