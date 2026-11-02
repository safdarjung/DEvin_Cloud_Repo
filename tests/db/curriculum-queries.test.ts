// M10-T4 — src/modules/academics/curriculum.queries.ts, called directly as
// plain query functions (not via HTTP), same pattern as
// tests/db/timetable-queries.test.ts (buildContext + setActingClient, real
// RLS underneath). Fixtures write lesson_plans/curriculum_unit_coverage
// straight via sql (T3's actions aren't a dependency of this task).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { curriculumCoverageBySection, curriculumLessonPlans, curriculumSectionUnits } from "@/modules/academics/curriculum.queries";

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

async function createUnit(institutionId: string, subjectId: string, gradeId: string, sequence: number): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${institutionId}, ${subjectId}, ${gradeId}, ${`Unit ${sequence}`}, ${sequence})
    returning id
  `;
  return row.id as string;
}

async function markCovered(
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  curriculumUnitId: string,
  markedBy: string,
  coveredOn = "2026-07-05",
): Promise<void> {
  await sql`
    insert into public.curriculum_unit_coverage (institution_id, class_section_id, subject_id, curriculum_unit_id, covered_on, marked_by)
    values (${institutionId}, ${classSectionId}, ${subjectId}, ${curriculumUnitId}, ${coveredOn}, ${markedBy})
  `;
}

async function createPlan(
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  createdBy: string,
  overrides: Partial<{ curriculumUnitId: string | null; plannedOn: string; title: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.lesson_plans (institution_id, class_section_id, subject_id, curriculum_unit_id, planned_on, title, objectives, created_by)
    values (
      ${institutionId}, ${classSectionId}, ${subjectId}, ${overrides.curriculumUnitId ?? null},
      ${overrides.plannedOn ?? "2026-07-01"}, ${overrides.title ?? "Intro"}, 'Cover unit', ${createdBy}
    )
    returning id
  `;
  return row.id as string;
}

async function studentIdFor(institutionId: string, role: "student" | "guardian", userId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return row.student_id as string;
}

describe("curriculum queries (M10-T4)", () => {
  it("coverageBySection: 4 units, 2 marked -> planned_units 4, completed_units 2", async () => {
    const inst = await createTestInstitution("curr-q-coverage");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2026-04-01", endsOn: "2027-03-31" });
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherStaff = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherStaff);
      const units = [1, 2, 3, 4].map((seq) => createUnit(inst.institutionId, subjectId, gradeId, seq));
      const [u1, u2] = await Promise.all(units);
      await markCovered(inst.institutionId, sectionId, subjectId, u1, inst.users.teacher.id);
      await markCovered(inst.institutionId, sectionId, subjectId, u2, inst.users.teacher.id);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const rows = await curriculumCoverageBySection(ctx, { classSectionId: sectionId, subjectId });
        expect(rows).toHaveLength(1);
        expect(rows[0].planned_units).toBe(4);
        expect(rows[0].completed_units).toBe(2);
        expect(rows[0].subject).toBe("Mathematics");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("coverageBySection: on_track flips with a mocked clock (early year true, late year false)", async () => {
    const inst = await createTestInstitution("curr-q-ontrack");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2026-04-01", endsOn: "2027-03-31" });
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherStaff = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherStaff);
      const units = [1, 2, 3, 4].map((seq) => createUnit(inst.institutionId, subjectId, gradeId, seq));
      const [u1, u2] = await Promise.all(units);
      await markCovered(inst.institutionId, sectionId, subjectId, u1, inst.users.teacher.id);
      await markCovered(inst.institutionId, sectionId, subjectId, u2, inst.users.teacher.id);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        vi.setSystemTime(new Date("2026-04-10T12:00:00Z")); // ~2% through the year
        const early = await curriculumCoverageBySection(ctx, { classSectionId: sectionId, subjectId });
        expect(early[0].on_track).toBe(true);

        vi.setSystemTime(new Date("2027-03-25T12:00:00Z")); // ~98% through the year
        const late = await curriculumCoverageBySection(ctx, { classSectionId: sectionId, subjectId });
        expect(late[0].on_track).toBe(false);
      } finally {
        vi.useRealTimers();
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("coverageBySection: guardian -> forbidden", async () => {
    const inst = await createTestInstitution("curr-q-guardian-forbidden");
    try {
      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        await expect(curriculumCoverageBySection(ctx, {})).rejects.toMatchObject({ code: "forbidden" });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("sectionUnits: guardian sees own child's section coverage, not another family's section", async () => {
    const inst = await createTestInstitution("curr-q-section-units");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionOwn = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const sectionOther = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const unit1 = await createUnit(inst.institutionId, subjectId, gradeId, 1);
      const unit2 = await createUnit(inst.institutionId, subjectId, gradeId, 2);
      await markCovered(inst.institutionId, sectionOwn, subjectId, unit1, inst.users.teacher.id, "2026-07-05");

      const ownChildId = await studentIdFor(inst.institutionId, "student", inst.users.student.id);
      await createEnrolment(inst.institutionId, ownChildId, sectionOwn, yearId, { rollNo: 1 });
      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${ownChildId}, 'father', true)
      `;

      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, otherStudent.id, sectionOther, yearId, { rollNo: 1 });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const ownRows = await curriculumSectionUnits(ctx, { classSectionId: sectionOwn, subjectId });
        expect(ownRows).toEqual([
          { id: unit1, title: "Unit 1", sequence: 1, coveredOn: "2026-07-05" },
          { id: unit2, title: "Unit 2", sequence: 2, coveredOn: null },
        ]);

        const otherRows = await curriculumSectionUnits(ctx, { classSectionId: sectionOther, subjectId });
        expect(otherRows).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("lessonPlans: accountant sees [], subject teacher sees own plans", async () => {
    const inst = await createTestInstitution("curr-q-lesson-plans");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherStaff = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherStaff);
      const planId = await createPlan(inst.institutionId, sectionId, subjectId, inst.users.teacher.id);

      const teacherCtx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const rows = await curriculumLessonPlans(teacherCtx, { classSectionId: sectionId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
          id: planId,
          classSectionId: sectionId,
          subjectId,
          curriculumUnitId: null,
          plannedOn: "2026-07-01",
          title: "Intro",
          objectives: "Cover unit",
          resources: null,
          createdBy: inst.users.teacher.id,
        });
      } finally {
        setActingClient(null);
      }

      const accountantCtx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const rows = await curriculumLessonPlans(accountantCtx, { classSectionId: sectionId });
        expect(rows).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
