// AI roles P4 — db tests for the 3 registered queries: exams.markOutliers,
// academics.gradeSuggestions, questionBank.paperDraft. Each: correctness on
// a fixture institution, another-tenant isolation, and a role without the
// query's permission gets `forbidden`. callAs (defineQuery-built Action<O>,
// same guardedCall as defineAction) + the opt-in server-client-mock so each
// handler's own createClient() runs with the calling role's real RLS.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { gradeSuggestionsQuery } from "@/modules/academics/query-defs";
import { examMarkOutliersQuery } from "@/modules/exams/query-defs";
import { questionBankPaperDraftQuery } from "@/modules/question-bank/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade, createSubject, createTerm } from "../helpers/factories";
import { closeRolesHelper, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function staffId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function userId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select user_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.user_id as string;
}

async function insertStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createExamRow(institutionId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      'marks_entry'
    )
    returning id
  `;
  return row.id as string;
}

async function createExamPaperRow(institutionId: string, examId: string, classSectionId: string, subjectId: string, maxMarks = 100): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, ${maxMarks}, 33)
    returning id
  `;
  return row.id as string;
}

async function insertMark(institutionId: string, examPaperId: string, studentId: string, marksObtained: number): Promise<void> {
  await sql`
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, source)
    values (${institutionId}, ${examPaperId}, ${studentId}, ${marksObtained}, false, 'entry')
  `;
}

/** app.marks_guard blocks marks_obtained > max_marks for every role — only `app.allow_reset = 'on'` bypasses it (same escape hatch foundation.test.ts/certificates-rls.test.ts use), needed to reproduce the "above_max" data-integrity case at all. */
async function insertOutOfRangeMark(institutionId: string, examPaperId: string, studentId: string, marksObtained: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.allow_reset', 'on', true)`;
    await tx`
      insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, source)
      values (${institutionId}, ${examPaperId}, ${studentId}, ${marksObtained}, false, 'entry')
    `;
  });
}

/** A previous published exam's result row, Math-subject-only snapshot (0009 shape) — results_guard has no INSERT-time check, so a plain insert is enough. */
async function insertPreviousResult(
  institutionId: string,
  previousExamId: string,
  studentId: string,
  subjectId: string,
  marksObtained: number,
  maxMarks: number,
): Promise<void> {
  await sql`
    insert into public.results (institution_id, exam_id, student_id, total, max_total, percentage, grade, snapshot, published_at)
    values (
      ${institutionId}, ${previousExamId}, ${studentId}, ${marksObtained}, ${maxMarks}, ${(marksObtained / maxMarks) * 100}, 'PASS',
      ${sql.json({
        subjects: [
          { exam_paper_id: crypto.randomUUID(), subject_id: subjectId, marks_obtained: marksObtained, max_marks: maxMarks, is_absent: false, passed: true, grade: "PASS" },
        ],
        attendancePercentage: 100,
      })},
      now() - interval '60 days'
    )
  `;
}

describe("exams.markOutliers (AI roles P4)", () => {
  it("detects marks above the paper max, a >=25pt subject drop vs the previous published exam, and a section average >=2 population-SD outlier; cross-tenant isolation; forbidden without exam.marks.enter", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const yearId = await createAcademicYear(a.institutionId);
      const termId = await createTerm(a.institutionId, yearId);
      const gradeId = await createGrade(a.institutionId);
      const subjectId = await createSubject(a.institutionId);

      // --- above_max: one paper, one clean mark, one out-of-range mark ---
      const sec1 = await createClassSection(a.institutionId, gradeId, yearId, { name: "AboveMax" });
      const examAbove = await createExamRow(a.institutionId, termId);
      const paperAbove = await createExamPaperRow(a.institutionId, examAbove, sec1, subjectId, 100);
      const studentClean = await insertStudent(a.institutionId);
      const studentOver = await insertStudent(a.institutionId);
      await insertMark(a.institutionId, paperAbove, studentClean, 70);
      await insertOutOfRangeMark(a.institutionId, paperAbove, studentOver, 150);

      const aboveRes = await callAs(a, "owner", examMarkOutliersQuery, { examId: examAbove });
      expect(aboveRes.ok).toBe(true);
      if (aboveRes.ok) {
        expect(aboveRes.data).toHaveLength(1);
        expect(aboveRes.data[0]).toMatchObject({
          outlierType: "above_max",
          studentId: studentOver,
          details: { marksObtained: 150, maxMarks: 100 },
        });
      }

      // --- percentage_drop: one paper, one student, a previous published exam in the same subject ---
      const sec2 = await createClassSection(a.institutionId, gradeId, yearId, { name: "Drop" });
      const examPrev = await createExamRow(a.institutionId, termId);
      const examDrop = await createExamRow(a.institutionId, termId);
      const paperDrop = await createExamPaperRow(a.institutionId, examDrop, sec2, subjectId, 100);
      const studentDrop = await insertStudent(a.institutionId);
      await insertPreviousResult(a.institutionId, examPrev, studentDrop, subjectId, 95, 100);
      await insertMark(a.institutionId, paperDrop, studentDrop, 60);

      const dropRes = await callAs(a, "owner", examMarkOutliersQuery, { examId: examDrop });
      expect(dropRes.ok).toBe(true);
      if (dropRes.ok) {
        expect(dropRes.data).toHaveLength(1);
        expect(dropRes.data[0]).toMatchObject({
          outlierType: "percentage_drop",
          studentId: studentDrop,
          details: { currentPercentage: 60, previousPercentage: 95, previousExamId: examPrev },
        });
      }

      // --- section_average: 5 one-student sections, 4 at 90%, 1 at 0% ---
      // mean = 72, population SD = 36 (perfect square by construction) -> the
      // 0% section's deviation (72) exactly meets the >=2*SD=72 threshold;
      // the 90% sections' deviation (18) does not.
      const examSection = await createExamRow(a.institutionId, termId);
      const lowSectionId = await createClassSection(a.institutionId, gradeId, yearId, { name: "Low" });
      const lowPaperId = await createExamPaperRow(a.institutionId, examSection, lowSectionId, subjectId, 100);
      await insertMark(a.institutionId, lowPaperId, await insertStudent(a.institutionId), 0);
      for (let i = 0; i < 4; i += 1) {
        const highSectionId = await createClassSection(a.institutionId, gradeId, yearId, { name: `High${i}` });
        const highPaperId = await createExamPaperRow(a.institutionId, examSection, highSectionId, subjectId, 100);
        await insertMark(a.institutionId, highPaperId, await insertStudent(a.institutionId), 90);
      }

      const sectionRes = await callAs(a, "owner", examMarkOutliersQuery, { examId: examSection });
      expect(sectionRes.ok).toBe(true);
      if (sectionRes.ok) {
        expect(sectionRes.data).toHaveLength(1);
        expect(sectionRes.data[0]).toMatchObject({
          outlierType: "section_average",
          studentId: null,
          classSectionId: lowSectionId,
          details: { sectionAveragePercentage: 0, examMeanPercentage: 72, examStddevPercentage: 36 },
        });
      }

      // --- cross-tenant isolation: institution b's owner gets nothing for institution a's exam ---
      const crossRes = await callAs(b, "owner", examMarkOutliersQuery, { examId: examAbove });
      expect(crossRes).toEqual({ ok: true, data: [] });

      // --- forbidden: guardian holds exam.result.read but not exam.marks.enter ---
      const forbiddenRes = await callAs(a, "guardian", examMarkOutliersQuery, { examId: examAbove });
      expect(forbiddenRes.ok).toBe(false);
      if (!forbiddenRes.ok) expect(forbiddenRes.error.code).toBe("forbidden");
    });
  });
});

describe("academics.gradeSuggestions (AI roles P4)", () => {
  async function createQuizAssignment(institutionId: string, classSectionId: string, subjectId: string): Promise<string> {
    const createdBy = await staffId(institutionId, "owner");
    const [row] = await sql`
      insert into public.assignments (institution_id, class_section_id, subject_id, title, content, status, created_by)
      values (
        ${institutionId}, ${classSectionId}, ${subjectId}, 'Quiz',
        ${sql.json({ questions: [{ stem: "2+2?", options: ["3", "4", "5", "6"] }, { stem: "Sky color?", options: ["red", "blue", "green", "black"] }] })},
        'published', ${createdBy}
      )
      returning id
    `;
    return row.id as string;
  }

  async function createAnswerKey(institutionId: string, assignmentId: string): Promise<void> {
    await sql`
      insert into public.assignment_answer_keys (institution_id, assignment_id, answers)
      values (${institutionId}, ${assignmentId}, ${sql.json({ questions: [{ answer: "4" }, { answer: "blue" }] })})
    `;
  }

  async function createSubmission(
    institutionId: string,
    assignmentId: string,
    studentId: string,
    content: { answers: string[] } | { text: string },
  ): Promise<string> {
    const [row] = await sql`
      insert into public.assignment_submissions (institution_id, assignment_id, student_id, content, status, submitted_at)
      values (${institutionId}, ${assignmentId}, ${studentId}, ${sql.json(content)}, 'submitted', now())
      returning id
    `;
    return row.id as string;
  }

  it("suggests a score per objective submission, skips non-comparable ones, reports a reason with no answer key, cross-tenant isolation, forbidden without assignment.manage", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const yearId = await createAcademicYear(a.institutionId);
      const gradeId = await createGrade(a.institutionId);
      const subjectId = await createSubject(a.institutionId);
      const sectionId = await createClassSection(a.institutionId, gradeId, yearId);

      const assignmentId = await createQuizAssignment(a.institutionId, sectionId, subjectId);
      await createAnswerKey(a.institutionId, assignmentId);

      const studentBoth = await insertStudent(a.institutionId);
      const studentOne = await insertStudent(a.institutionId);
      const studentFreeText = await insertStudent(a.institutionId);
      const subBoth = await createSubmission(a.institutionId, assignmentId, studentBoth, { answers: ["4", "blue"] });
      const subOne = await createSubmission(a.institutionId, assignmentId, studentOne, { answers: ["3", "blue"] });
      await createSubmission(a.institutionId, assignmentId, studentFreeText, { text: "an essay answer" });

      const res = await callAs(a, "owner", gradeSuggestionsQuery, { assignmentId });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.reason).toBeNull();
        expect(res.data.suggestions).toHaveLength(2);
        const bySubmission = new Map(res.data.suggestions.map((s) => [s.submissionId, s]));
        expect(bySubmission.get(subBoth)).toMatchObject({ studentId: studentBoth, correctCount: 2, suggestedScore: 2, maxScore: 2 });
        expect(bySubmission.get(subOne)).toMatchObject({ studentId: studentOne, correctCount: 1, suggestedScore: 1, maxScore: 2 });
      }

      // --- no answer key: reason, empty list, never an error ---
      const noKeyAssignmentId = await createQuizAssignment(a.institutionId, sectionId, subjectId);
      const noKeyRes = await callAs(a, "owner", gradeSuggestionsQuery, { assignmentId: noKeyAssignmentId });
      expect(noKeyRes).toEqual({ ok: true, data: { suggestions: [], reason: expect.any(String) } });

      // --- cross-tenant isolation: institution b's owner sees no answer key for institution a's assignment ---
      const crossRes = await callAs(b, "owner", gradeSuggestionsQuery, { assignmentId });
      expect(crossRes.ok).toBe(true);
      if (crossRes.ok) {
        expect(crossRes.data.suggestions).toEqual([]);
        expect(crossRes.data.reason).toEqual(expect.any(String));
      }

      // --- forbidden: student holds assignment.read but not assignment.manage ---
      const forbiddenRes = await callAs(a, "student", gradeSuggestionsQuery, { assignmentId });
      expect(forbiddenRes.ok).toBe(false);
      if (!forbiddenRes.ok) expect(forbiddenRes.error.code).toBe("forbidden");
    });
  });
});

describe("questionBank.paperDraft (AI roles P4)", () => {
  async function createQuestion(
    institutionId: string,
    subjectId: string,
    gradeId: string,
    curriculumUnitId: string,
    difficulty: "easy" | "medium" | "hard",
    marks: number,
  ): Promise<string> {
    const createdBy = await userId(institutionId, "owner");
    const [row] = await sql`
      insert into public.question_bank (institution_id, subject_id, grade_id, curriculum_unit_id, type, difficulty, body, answer, marks, created_by)
      values (${institutionId}, ${subjectId}, ${gradeId}, ${curriculumUnitId}, 'short_answer', ${difficulty}, 'Body', 'Answer', ${marks}, ${createdBy})
      returning id
    `;
    return row.id as string;
  }

  it("builds a deterministic draft honoring the difficulty mix, cross-tenant isolation, forbidden without question.manage", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const gradeId = await createGrade(a.institutionId);
      const subjectId = await createSubject(a.institutionId);
      const [unit] = await sql`
        insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
        values (${a.institutionId}, ${subjectId}, ${gradeId}, 'Unit 1', 1)
        returning id
      `;
      const unitId = unit.id as string;

      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "easy", 2);
      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "easy", 2);
      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "medium", 3);
      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "medium", 3);
      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "hard", 5);
      await createQuestion(a.institutionId, subjectId, gradeId, unitId, "hard", 5);

      // target marks: easy 4, medium 3, hard 3 (both hard questions cost 5 -> skipped, 10-7=3 left unfilled)
      const res = await callAs(a, "owner", questionBankPaperDraftQuery, {
        unitIds: [unitId],
        totalMarks: 10,
        difficultyMix: { easy: 0.4, medium: 0.3, hard: 0.3 },
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.totalMarksRequested).toBe(10);
        expect(res.data.totalMarksSelected).toBe(7);
        const byDifficulty = Object.groupBy(res.data.questions, (q) => q.difficulty);
        expect(byDifficulty.easy).toHaveLength(2);
        expect(byDifficulty.medium).toHaveLength(1);
        expect(byDifficulty.hard ?? []).toHaveLength(0);
      }

      // determinism: same input -> same output (stable id order, no randomness)
      const res2 = await callAs(a, "owner", questionBankPaperDraftQuery, {
        unitIds: [unitId],
        totalMarks: 10,
        difficultyMix: { easy: 0.4, medium: 0.3, hard: 0.3 },
      });
      expect(res2).toEqual(res);

      // --- cross-tenant isolation: institution b's owner sees no questions for institution a's unit ---
      const crossRes = await callAs(b, "owner", questionBankPaperDraftQuery, { unitIds: [unitId], totalMarks: 10 });
      expect(crossRes).toEqual({ ok: true, data: { questions: [], totalMarksRequested: 10, totalMarksSelected: 0, note: expect.any(String) } });

      // --- forbidden: guardian does not hold question.manage ---
      const forbiddenRes = await callAs(a, "guardian", questionBankPaperDraftQuery, { unitIds: [unitId], totalMarks: 10 });
      expect(forbiddenRes.ok).toBe(false);
      if (!forbiddenRes.ok) expect(forbiddenRes.error.code).toBe("forbidden");
    });
  });
});
