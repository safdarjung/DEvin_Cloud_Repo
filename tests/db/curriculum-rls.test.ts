import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function createUnit(
  institutionId: string,
  subjectId: string,
  gradeId: string,
  sequence: number,
): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${institutionId}, ${subjectId}, ${gradeId}, ${`Unit ${sequence}`}, ${sequence})
    returning id
  `;
  return row.id as string;
}

interface Base {
  yearId: string;
  gradeId: string;
  gradeOther: string;
  sectionA: string;
  sectionB: string;
  teacherStaffId: string;
  subjectX: string;
  subjectY: string;
  unitX1: string;
  unitOtherGrade: string;
  studentId: string;
}

async function setupBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const gradeOther = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
  const teacherStaff = await teacherStaffId(inst.institutionId);
  // sectionA: teacher is a subject teacher (subject_assignments), not class teacher.
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  // sectionB: teacher is the class teacher.
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: teacherStaff });
  const subjectX = await createSubject(inst.institutionId, { code: "SUB-X", name: "Mathematics" });
  const subjectY = await createSubject(inst.institutionId, { code: "SUB-Y", name: "Science" });
  await createSubjectAssignment(inst.institutionId, sectionA, subjectX, teacherStaff);
  const unitX1 = await createUnit(inst.institutionId, subjectX, gradeId, 1);
  const unitOtherGrade = await createUnit(inst.institutionId, subjectX, gradeOther, 1);

  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  return {
    yearId,
    gradeId,
    gradeOther,
    sectionA,
    sectionB,
    teacherStaffId: teacherStaff,
    subjectX,
    subjectY,
    unitX1,
    unitOtherGrade,
    studentId: studentMembership.student_id as string,
  };
}

describe("migration 0072: lesson_plans + curriculum_unit_coverage RLS + guards", () => {
  it("subject teacher inserts a lesson plan + coverage for own (section, subject)", async () => {
    const inst = await createTestInstitution("curr-subject-teacher");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(plan.error).toBeNull();

      const coverage = await inst.clientAs("teacher").from("curriculum_unit_coverage").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        covered_on: "2026-07-05",
        lesson_plan_id: plan.data!.id,
        marked_by: inst.users.teacher.id,
      }).select("id").single();
      expect(coverage.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("same teacher for another subject in a section they don't class-teach -> 42501", async () => {
    const inst = await createTestInstitution("curr-wrong-subject");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectY,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      });
      expect(plan.error).not.toBeNull();
      expect(plan.error!.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("class teacher writes any subject in own section", async () => {
    const inst = await createTestInstitution("curr-class-teacher");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionB,
        subject_id: base.subjectY,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(plan.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("unit from another grade -> 42501", async () => {
    const inst = await createTestInstitution("curr-unit-wrong-grade");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitOtherGrade,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      });
      expect(plan.error).not.toBeNull();
      expect(plan.error!.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-institution section/unit -> 42501", async () => {
    const instA = await createTestInstitution("curr-cross-a");
    const instB = await createTestInstitution("curr-cross-b");
    try {
      const baseA = await setupBase(instA);
      const baseB = await setupBase(instB);

      const plan = await instA.clientAs("teacher").from("lesson_plans").insert({
        institution_id: instA.institutionId,
        class_section_id: baseB.sectionA,
        subject_id: baseA.subjectX,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: instA.users.teacher.id,
      });
      expect(plan.error).not.toBeNull();
      expect(plan.error!.code).toBe("42501");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("duplicate (section, unit) coverage -> 23505", async () => {
    const inst = await createTestInstitution("curr-dup-coverage");
    try {
      const base = await setupBase(inst);

      const first = await inst.clientAs("teacher").from("curriculum_unit_coverage").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        covered_on: "2026-07-05",
        marked_by: inst.users.teacher.id,
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("teacher").from("curriculum_unit_coverage").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        covered_on: "2026-07-10",
        marked_by: inst.users.teacher.id,
      });
      expect(second.error).not.toBeNull();
      expect(second.error!.code).toBe("23505");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher updates created_by/class_section_id -> code:forbidden", async () => {
    const inst = await createTestInstitution("curr-guard-identity");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(plan.error).toBeNull();

      const changeCreatedBy = await inst.clientAs("teacher").from("lesson_plans")
        .update({ created_by: inst.users.admin.id })
        .eq("id", plan.data!.id);
      expect(changeCreatedBy.error).not.toBeNull();
      expect(changeCreatedBy.error!.message).toContain("forbidden");

      const changeSection = await inst.clientAs("teacher").from("lesson_plans")
        .update({ class_section_id: base.sectionB })
        .eq("id", plan.data!.id);
      expect(changeSection.error).not.toBeNull();
      expect(changeSection.error!.message).toContain("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian reads own child's section coverage only and no lesson plans", async () => {
    const inst = await createTestInstitution("curr-guardian");
    try {
      const base = await setupBase(inst);

      const plan = await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(plan.error).toBeNull();

      await inst.clientAs("teacher").from("curriculum_unit_coverage").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        covered_on: "2026-07-05",
        lesson_plan_id: plan.data!.id,
        marked_by: inst.users.teacher.id,
      });

      await sql`
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
        values (${inst.institutionId}, ${base.studentId}, ${base.sectionA}, ${base.yearId}, '2026-04-01', 'active')
      `;
      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${base.studentId}, 'father', true)
      `;

      const coverageRead = await inst.clientAs("guardian").from("curriculum_unit_coverage").select("id");
      expect(coverageRead.error).toBeNull();
      expect(coverageRead.data).toHaveLength(1);

      const planRead = await inst.clientAs("guardian").from("lesson_plans").select("id");
      expect(planRead.error).toBeNull();
      expect(planRead.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant reads coverage, not lesson plans", async () => {
    const inst = await createTestInstitution("curr-accountant");
    try {
      const base = await setupBase(inst);

      await inst.clientAs("teacher").from("lesson_plans").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        planned_on: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
        created_by: inst.users.teacher.id,
      });
      await inst.clientAs("teacher").from("curriculum_unit_coverage").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionA,
        subject_id: base.subjectX,
        curriculum_unit_id: base.unitX1,
        covered_on: "2026-07-05",
        marked_by: inst.users.teacher.id,
      });

      const coverageRead = await inst.clientAs("accountant").from("curriculum_unit_coverage").select("id");
      expect(coverageRead.error).toBeNull();
      expect(coverageRead.data).toHaveLength(1);

      const planRead = await inst.clientAs("accountant").from("lesson_plans").select("id");
      expect(planRead.error).toBeNull();
      expect(planRead.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
