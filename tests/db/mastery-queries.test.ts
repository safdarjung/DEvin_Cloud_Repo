// M20-T8 — mastery.heatmapBySection / mastery.gapsForStudent, exercised as
// the registered defineQuery actions (callAs), same shape as
// tests/db/exam-seating-queries.test.ts.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { masteryGapsForStudentQuery, masteryHeatmapBySectionQuery } from "@/modules/mastery/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertSnapshots } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

describe("mastery.heatmapBySection / mastery.gapsForStudent (M20-T8)", () => {
  it("owner heatmap returns exact cells (mean mastery_pct, below) for the fixture", async () => {
    const inst = await createTestInstitution("mastery-q-heatmap-owner");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.75, confidence: 0.75 },
        { studentId: fx.students.a2, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.55, confidence: 0.6 },
        { studentId: fx.students.b1, classSectionId: fx.sections.b, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.9, confidence: 0.8 },
        { studentId: fx.students.c1, classSectionId: fx.sections.c, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.3, confidence: 0.6 },
      ]);

      const result = await callAs(inst, "owner", masteryHeatmapBySectionQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([
        expect.objectContaining({ section_id: fx.sections.a, subject: "Maths", topic_id: fx.subjects.maths.units[0], mastery_pct: 65, students_below_threshold: 1 }),
        expect.objectContaining({ section_id: fx.sections.b, subject: "Science", topic_id: fx.subjects.science.units[0], mastery_pct: 90, students_below_threshold: 0 }),
        expect.objectContaining({ section_id: fx.sections.c, subject: "Maths", topic_id: fx.subjects.maths.units[0], mastery_pct: 30, students_below_threshold: 1 }),
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher heatmap excludes section C (not taught, not class-teacher)", async () => {
    const inst = await createTestInstitution("mastery-q-heatmap-teacher");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.75, confidence: 0.75 },
        { studentId: fx.students.b1, classSectionId: fx.sections.b, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.9, confidence: 0.8 },
        { studentId: fx.students.c1, classSectionId: fx.sections.c, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.3, confidence: 0.6 },
      ]);

      const result = await callAs(inst, "teacher", masteryHeatmapBySectionQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.map((c) => c.section_id).sort()).toEqual([fx.sections.a, fx.sections.b].sort());
    } finally {
      await inst.cleanup();
    }
  });

  it("subjectId filter narrows the heatmap to that subject's cells", async () => {
    const inst = await createTestInstitution("mastery-q-heatmap-subject");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.75, confidence: 0.75 },
        { studentId: fx.students.b1, classSectionId: fx.sections.b, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.9, confidence: 0.8 },
      ]);

      const result = await callAs(inst, "owner", masteryHeatmapBySectionQuery, { subjectId: fx.subjects.science.id });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ subject: "Science", section_id: fx.sections.b });
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian gets the child's gaps, weakest first", async () => {
    const inst = await createTestInstitution("mastery-q-gaps-guardian");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        // not a gap: score >= 0.6
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[1], score: 0.8, confidence: 0.9 },
        // gap, pct 50
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.5, confidence: 0.6 },
        // gap, pct 30 (weakest)
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.3, confidence: 0.55 },
      ]);

      const result = await callAs(inst, "guardian", masteryGapsForStudentQuery, { studentId: fx.students.fixture });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([
        { subject: "Science", topic: "Forces", mastery_pct: 30 },
        { subject: "Maths", topic: "Algebra basics", mastery_pct: 50 },
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian asking for another family's student gets [] (RLS blocks the snapshot read)", async () => {
    const inst = await createTestInstitution("mastery-q-gaps-outside");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.b1, classSectionId: fx.sections.b, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.3, confidence: 0.6 },
      ]);

      const result = await callAs(inst, "guardian", masteryGapsForStudentQuery, { studentId: fx.students.b1 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("student gets their own gaps", async () => {
    const inst = await createTestInstitution("mastery-q-gaps-student");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.45, confidence: 0.6 },
      ]);

      const result = await callAs(inst, "student", masteryGapsForStudentQuery, { studentId: fx.students.fixture });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([{ subject: "Maths", topic: "Algebra basics", mastery_pct: 45 }]);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant is forbidden (no mastery.review)", async () => {
    const inst = await createTestInstitution("mastery-q-forbidden-accountant");
    try {
      const result = await callAs(inst, "accountant", masteryHeatmapBySectionQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("mastery module disabled: forbidden with MODULE_DISABLED_MESSAGE", async () => {
    const inst = await createTestInstitution("mastery-q-module-off");
    try {
      await sql`update public.institutions set settings = jsonb_set(settings, '{modules,mastery}', 'false'::jsonb) where id = ${inst.institutionId}`;

      const result = await callAs(inst, "owner", masteryHeatmapBySectionQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatchObject({ code: "forbidden", message: MODULE_DISABLED_MESSAGE });
    } finally {
      await inst.cleanup();
    }
  });

  it("exams module disabled: mastery is forbidden too (requires exams)", async () => {
    const inst = await createTestInstitution("mastery-q-exams-off");
    try {
      await sql`update public.institutions set settings = jsonb_set(settings, '{modules,exams}', 'false'::jsonb) where id = ${inst.institutionId}`;

      const result = await callAs(inst, "owner", masteryHeatmapBySectionQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatchObject({ code: "forbidden", message: MODULE_DISABLED_MESSAGE });
    } finally {
      await inst.cleanup();
    }
  });
});
