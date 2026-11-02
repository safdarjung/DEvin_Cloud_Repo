import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (C-03 pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { deleteLessonPlan, markCovered, upsertLessonPlan, upsertUnit } from "@/modules/academics/curriculum.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M10-T3 — curriculum.unit.upsert / curriculum.lessonPlan.upsert /
// curriculum.lessonPlan.delete / curriculum.markCovered.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function createUnit(institutionId: string, subjectId: string, gradeId: string, sequence: number, title = `Unit ${sequence}`): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${institutionId}, ${subjectId}, ${gradeId}, ${title}, ${sequence})
    returning id
  `;
  return row.id as string;
}

interface Base {
  gradeId: string;
  gradeOther: string;
  sectionA: string;
  teacherStaffId: string;
  subjectX: string;
  subjectY: string;
}

async function setupBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const gradeOther = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectX = await createSubject(inst.institutionId, { code: "SUB-X", name: "Mathematics" });
  const subjectY = await createSubject(inst.institutionId, { code: "SUB-Y", name: "Science" });
  await createSubjectAssignment(inst.institutionId, sectionA, subjectX, teacherStaff);
  return { gradeId, gradeOther, sectionA, teacherStaffId: teacherStaff, subjectX, subjectY };
}

describe("curriculum actions (M10-T3)", () => {
  it("admin upserts a unit, duplicate sequence -> conflict naming sequence", async () => {
    const inst = await createTestInstitution("curr-unit-conflict");
    try {
      const base = await setupBase(inst);

      const created = await callAs(inst, "admin", upsertUnit, {
        gradeId: base.gradeId,
        subjectId: base.subjectX,
        title: "Algebra basics",
        sequence: 1,
      });
      expect(created.ok).toBe(true);

      const dup = await callAs(inst, "admin", upsertUnit, {
        gradeId: base.gradeId,
        subjectId: base.subjectX,
        title: "Another unit",
        sequence: 1,
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.sequence).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("subject teacher creates a plan and marks its unit covered; teacher of another subject is forbidden", async () => {
    const inst = await createTestInstitution("curr-plan-cover");
    try {
      const base = await setupBase(inst);
      const unit = await createUnit(inst.institutionId, base.subjectX, base.gradeId, 1);

      const plan = await callAs(inst, "teacher", upsertLessonPlan, {
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        curriculumUnitId: unit,
        plannedOn: "2026-07-01",
        title: "Intro to algebra",
        objectives: "Cover unit 1",
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;

      const covered = await callAs(inst, "teacher", markCovered, {
        classSectionId: base.sectionA,
        curriculumUnitId: unit,
        covered: true,
        coveredOn: "2026-07-05",
        lessonPlanId: plan.data.id,
      });
      expect(covered.ok).toBe(true);
      if (!covered.ok) return;
      expect(covered.data).toEqual({ id: expect.any(String), covered: true });

      // Teacher is only a subject teacher for subjectX, not subjectY, in sectionA.
      const otherSubjectUnit = await createUnit(inst.institutionId, base.subjectY, base.gradeId, 1, "Science unit");
      const forbidden = await callAs(inst, "teacher", markCovered, {
        classSectionId: base.sectionA,
        curriculumUnitId: otherSubjectUnit,
        covered: true,
        coveredOn: "2026-07-05",
      });
      expect(forbidden.ok).toBe(false);
      if (forbidden.ok) return;
      expect(forbidden.error.code).toBe("forbidden");

      const removed = await callAs(inst, "teacher", markCovered, {
        classSectionId: base.sectionA,
        curriculumUnitId: unit,
        covered: false,
      });
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;
      expect(removed.data).toEqual({ id: null, covered: false });

      const [row] = await sql`select id from public.curriculum_unit_coverage where class_section_id = ${base.sectionA} and curriculum_unit_id = ${unit}`;
      expect(row).toBeUndefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("unit of another grade -> validation_failed naming curriculumUnitId", async () => {
    const inst = await createTestInstitution("curr-wrong-grade");
    try {
      const base = await setupBase(inst);
      const otherGradeUnit = await createUnit(inst.institutionId, base.subjectX, base.gradeOther, 1);

      const result = await callAs(inst, "teacher", upsertLessonPlan, {
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        curriculumUnitId: otherGradeUnit,
        plannedOn: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors?.curriculumUnitId).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("coveredOn tomorrow -> validation_failed", async () => {
    const inst = await createTestInstitution("curr-future-date");
    try {
      const base = await setupBase(inst);
      const unit = await createUnit(inst.institutionId, base.subjectX, base.gradeId, 1);
      // +2 days in UTC: always after "today" in the institution timezone (IST is ahead of UTC, so +1 day UTC equals IST today between 00:00–05:30 IST).
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

      const result = await callAs(inst, "teacher", markCovered, {
        classSectionId: base.sectionA,
        curriculumUnitId: unit,
        covered: true,
        coveredOn: tomorrow,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors?.coveredOn).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("admin markCovered -> forbidden (permission gate: assignment.manage)", async () => {
    const inst = await createTestInstitution("curr-admin-gate");
    try {
      const base = await setupBase(inst);
      const unit = await createUnit(inst.institutionId, base.subjectX, base.gradeId, 1);

      const result = await callAs(inst, "admin", markCovered, {
        classSectionId: base.sectionA,
        curriculumUnitId: unit,
        covered: true,
        coveredOn: "2026-07-05",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("deleteLessonPlan removes a plan; 0 rows is not_found", async () => {
    const inst = await createTestInstitution("curr-plan-delete");
    try {
      const base = await setupBase(inst);
      const plan = await callAs(inst, "teacher", upsertLessonPlan, {
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        plannedOn: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;

      const deleted = await callAs(inst, "teacher", deleteLessonPlan, { id: plan.data.id });
      expect(deleted.ok).toBe(true);

      const again = await callAs(inst, "teacher", deleteLessonPlan, { id: plan.data.id });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("update path (id given) edits title/objectives/curriculumUnitId in place", async () => {
    const inst = await createTestInstitution("curr-plan-update");
    try {
      const base = await setupBase(inst);
      const unit = await createUnit(inst.institutionId, base.subjectX, base.gradeId, 1);

      const plan = await callAs(inst, "teacher", upsertLessonPlan, {
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        plannedOn: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;

      const updated = await callAs(inst, "teacher", upsertLessonPlan, {
        id: plan.data.id,
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        curriculumUnitId: unit,
        plannedOn: "2026-07-01",
        title: "Intro to algebra (revised)",
        objectives: "Cover unit 1 in depth",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.id).toBe(plan.data.id);

      const [row] = await sql`select title, objectives, curriculum_unit_id, class_section_id from public.lesson_plans where id = ${plan.data.id}`;
      expect(row.title).toBe("Intro to algebra (revised)");
      expect(row.objectives).toBe("Cover unit 1 in depth");
      expect(row.curriculum_unit_id).toBe(unit);
      expect(row.class_section_id).toBe(base.sectionA);
    } finally {
      await inst.cleanup();
    }
  });

  it("update path with a mismatched classSectionId -> validation_failed, real row untouched", async () => {
    const inst = await createTestInstitution("curr-plan-update-mismatch");
    try {
      const base = await setupBase(inst);
      const yearId = await createAcademicYear(inst.institutionId, { name: "2026-27-B", isCurrent: false });
      const sectionB = await createClassSection(inst.institutionId, base.gradeOther, yearId, { name: "B" });
      const otherGradeUnit = await createUnit(inst.institutionId, base.subjectX, base.gradeOther, 1, "Other grade unit");

      const plan = await callAs(inst, "teacher", upsertLessonPlan, {
        classSectionId: base.sectionA,
        subjectId: base.subjectX,
        plannedOn: "2026-07-01",
        title: "Intro",
        objectives: "Cover unit 1",
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;

      // Client supplies sectionB (a different, mismatched section) while
      // updating a plan that actually belongs to sectionA. The app pre-check
      // must reject this against the plan's real persisted section, not run
      // the unit/grade check against the client-supplied sectionB/otherGradeUnit.
      const result = await callAs(inst, "teacher", upsertLessonPlan, {
        id: plan.data.id,
        classSectionId: sectionB,
        subjectId: base.subjectX,
        curriculumUnitId: otherGradeUnit,
        plannedOn: "2026-07-01",
        title: "Hijacked",
        objectives: "Should not apply",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors?.classSectionId).toBeDefined();

      const [row] = await sql`select title, class_section_id from public.lesson_plans where id = ${plan.data.id}`;
      expect(row.title).toBe("Intro");
      expect(row.class_section_id).toBe(base.sectionA);
    } finally {
      await inst.cleanup();
    }
  });
});
