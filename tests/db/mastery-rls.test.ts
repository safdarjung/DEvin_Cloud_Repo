// M20-T4 — mastery_snapshots RLS + exam_papers.unit_ids validation
// (migration 0093 part 1, M20-tasks.md Task 4 TEST FIRST).
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertSnapshots } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

async function createExam(institutionId: string, academicYearId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${institutionId}, ${academicYearId}, ${termId}, ${`Exam-${crypto.randomUUID().slice(0, 8)}`}, 'unit_test', 'draft')
    returning id
  `;
  return row.id as string;
}

async function createExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33)
    returning id
  `;
  return row.id as string;
}

describe("mastery_snapshots RLS (mirrors results_select)", () => {
  it("owner, admin, exam_controller read every fixture row", async () => {
    const inst = await createTestInstitution("mastery-rls-staff-wide");
    try {
      const fx = await buildMasteryFixture(inst);
      const ids = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
        {
          studentId: fx.students.a2,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[1],
        },
        {
          studentId: fx.students.b1,
          classSectionId: fx.sections.b,
          subjectId: fx.subjects.science.id,
          curriculumUnitId: fx.subjects.science.units[0],
        },
        {
          studentId: fx.students.c1,
          classSectionId: fx.sections.c,
          subjectId: fx.subjects.science.id,
          curriculumUnitId: fx.subjects.science.units[1],
        },
      ]);

      for (const role of ["owner", "admin", "exam_controller"] as const) {
        const { data, error } = await inst.clientAs(role).from("mastery_snapshots").select("id");
        expect(error).toBeNull();
        expect((data ?? []).map((r) => r.id as string).sort()).toEqual([...ids].sort());
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher reads A and B rows, not C", async () => {
    const inst = await createTestInstitution("mastery-rls-teacher-scope");
    try {
      const fx = await buildMasteryFixture(inst);
      const [aId] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
      ]);
      const [bId] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.b1,
          classSectionId: fx.sections.b,
          subjectId: fx.subjects.science.id,
          curriculumUnitId: fx.subjects.science.units[0],
        },
      ]);
      const [cId] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.c1,
          classSectionId: fx.sections.c,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[1],
        },
      ]);

      const { data, error } = await inst.clientAs("teacher").from("mastery_snapshots").select("id");
      expect(error).toBeNull();
      const resultIds = (data ?? []).map((r) => r.id as string);
      expect(resultIds.sort()).toEqual([aId, bId].sort());
      expect(resultIds).not.toContain(cId);
    } finally {
      await inst.cleanup();
    }
  });

  it("student reads own rows only", async () => {
    const inst = await createTestInstitution("mastery-rls-student-scope");
    try {
      const fx = await buildMasteryFixture(inst);
      const [ownId] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
      ]);
      await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.a2,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[1],
        },
      ]);

      const { data, error } = await inst.clientAs("student").from("mastery_snapshots").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id as string)).toEqual([ownId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian reads the child's rows only", async () => {
    const inst = await createTestInstitution("mastery-rls-guardian-scope");
    try {
      const fx = await buildMasteryFixture(inst);
      const [childId] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
      ]);
      await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.b1,
          classSectionId: fx.sections.b,
          subjectId: fx.subjects.science.id,
          curriculumUnitId: fx.subjects.science.units[0],
        },
      ]);

      const { data, error } = await inst.clientAs("guardian").from("mastery_snapshots").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id as string)).toEqual([childId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant and admissions read 0 rows", async () => {
    const inst = await createTestInstitution("mastery-rls-no-access");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
      ]);

      for (const role of ["accountant", "admissions"] as const) {
        const { data, error } = await inst.clientAs(role).from("mastery_snapshots").select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("authenticated insert/update/delete are rejected (no write grant)", async () => {
    const inst = await createTestInstitution("mastery-rls-no-write");
    try {
      const fx = await buildMasteryFixture(inst);
      const [id] = await insertSnapshots(inst, fx, [
        {
          studentId: fx.students.fixture,
          classSectionId: fx.sections.a,
          subjectId: fx.subjects.maths.id,
          curriculumUnitId: fx.subjects.maths.units[0],
        },
      ]);

      const insertAttempt = await inst.clientAs("owner").from("mastery_snapshots").insert({
        institution_id: inst.institutionId,
        academic_year_id: fx.academicYearId,
        student_id: fx.students.a2,
        class_section_id: fx.sections.a,
        subject_id: fx.subjects.maths.id,
        curriculum_unit_id: fx.subjects.maths.units[1],
        score: 0.5,
        confidence: 0.5,
        mark_count: 1,
        submission_count: 0,
        evidence: [{ label: "x", value: 1 }],
        detector_version: "mastery_v1",
        computed_at: new Date().toISOString(),
      });
      expect(insertAttempt.error?.code).toBe("42501");

      const updateAttempt = await inst.clientAs("owner").from("mastery_snapshots").update({ score: 0.9 }).eq("id", id);
      expect(updateAttempt.error?.code).toBe("42501");

      const deleteAttempt = await inst.clientAs("owner").from("mastery_snapshots").delete().eq("id", id);
      expect(deleteAttempt.error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("exam_papers.unit_ids validation (app.validate_exam_paper_units)", () => {
  it("rejects a duplicate unit id", async () => {
    const inst = await createTestInstitution("mastery-unit-ids-duplicate");
    try {
      const fx = await buildMasteryFixture(inst);
      const examId = await createExam(inst.institutionId, fx.academicYearId, fx.termId);
      const paperId = await createExamPaper(inst.institutionId, examId, fx.sections.a, fx.subjects.maths.id);

      await expect(
        sql`update public.exam_papers set unit_ids = ${[fx.subjects.maths.units[0], fx.subjects.maths.units[0]]} where id = ${paperId}`,
      ).rejects.toThrow(/validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects a unit of another subject", async () => {
    const inst = await createTestInstitution("mastery-unit-ids-wrong-subject");
    try {
      const fx = await buildMasteryFixture(inst);
      const examId = await createExam(inst.institutionId, fx.academicYearId, fx.termId);
      const paperId = await createExamPaper(inst.institutionId, examId, fx.sections.a, fx.subjects.maths.id);

      await expect(
        sql`update public.exam_papers set unit_ids = ${[fx.subjects.maths.units[0], fx.subjects.science.units[0]]} where id = ${paperId}`,
      ).rejects.toThrow(/validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects another institution's unit", async () => {
    const inst = await createTestInstitution("mastery-unit-ids-cross-inst");
    const otherInstitutionId = crypto.randomUUID();
    try {
      const fx = await buildMasteryFixture(inst);
      const examId = await createExam(inst.institutionId, fx.academicYearId, fx.termId);
      const paperId = await createExamPaper(inst.institutionId, examId, fx.sections.a, fx.subjects.maths.id);

      await sql`
        insert into public.institutions (id, slug, name)
        values (${otherInstitutionId}, ${`mastery-other-${otherInstitutionId}`}, 'Other institution')
      `;
      const [otherGrade] = await sql`
        insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
        values (${otherInstitutionId}, 'VI', 'Grade VI', 6, 'middle')
        returning id
      `;
      const [otherSubject] = await sql`
        insert into public.subjects (institution_id, code, name, kind)
        values (${otherInstitutionId}, 'MATH-OTHER', 'Maths', 'scholastic')
        returning id
      `;
      const [otherUnit] = await sql`
        insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
        values (${otherInstitutionId}, ${otherSubject.id}, ${otherGrade.id}, 'Cross-institution unit', 1)
        returning id
      `;

      await expect(
        sql`update public.exam_papers set unit_ids = ${[otherUnit.id]} where id = ${paperId}`,
      ).rejects.toThrow(/validation_failed/);
    } finally {
      await sql`delete from public.curriculum_units where institution_id = ${otherInstitutionId}`;
      await sql`delete from public.subjects where institution_id = ${otherInstitutionId}`;
      await sql`delete from public.grades where institution_id = ${otherInstitutionId}`;
      await sql`delete from public.institutions where id = ${otherInstitutionId}`;
      await inst.cleanup();
    }
  });

  it("21 distinct, valid unit ids are rejected by the cardinality check (23514)", async () => {
    const inst = await createTestInstitution("mastery-unit-ids-cardinality");
    try {
      const fx = await buildMasteryFixture(inst);
      const examId = await createExam(inst.institutionId, fx.academicYearId, fx.termId);
      const paperId = await createExamPaper(inst.institutionId, examId, fx.sections.a, fx.subjects.maths.id);

      const extraUnits: string[] = [];
      for (let seq = 3; seq <= 21; seq++) {
        const [row] = await sql`
          insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
          values (${inst.institutionId}, ${fx.subjects.maths.id}, ${fx.gradeId}, ${`Extra unit ${seq}`}, ${seq})
          returning id
        `;
        extraUnits.push(row.id as string);
      }
      const twentyOne = [...fx.subjects.maths.units, ...extraUnits];
      expect(twentyOne).toHaveLength(21);

      await expect(sql`update public.exam_papers set unit_ids = ${twentyOne} where id = ${paperId}`).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await inst.cleanup();
    }
  });

  it("stores 2 valid unit ids", async () => {
    const inst = await createTestInstitution("mastery-unit-ids-valid");
    try {
      const fx = await buildMasteryFixture(inst);
      const examId = await createExam(inst.institutionId, fx.academicYearId, fx.termId);
      const paperId = await createExamPaper(inst.institutionId, examId, fx.sections.a, fx.subjects.maths.id);

      await sql`update public.exam_papers set unit_ids = ${fx.subjects.maths.units} where id = ${paperId}`;
      const [row] = await sql`select unit_ids from public.exam_papers where id = ${paperId}`;
      expect((row.unit_ids as string[]).slice().sort()).toEqual([...fx.subjects.maths.units].sort());
    } finally {
      await inst.cleanup();
    }
  });
});
