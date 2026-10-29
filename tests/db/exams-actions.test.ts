import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  closeMarksEntry,
  createExam,
  createExamPapers,
  enterMarks,
  openMarksEntry,
  reopenMarksEntry,
  verifyExam,
} from "@/modules/exams/actions";
import { getPaperMarks } from "@/modules/exams/queries";
import type { Database } from "@/lib/db/types";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function setExamSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'exams', jsonb_build_object(
        'pass_percentage', 33,
        'grading_scales', jsonb_build_object('default', jsonb_build_array(
          jsonb_build_object('min', 33, 'max', 100, 'grade', 'PASS', 'points', 1),
          jsonb_build_object('min', 0, 'max', 32, 'grade', 'FAIL', 'points', 0, 'fail', true)
        ))
      )
    )
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function examStatus(examId: string): Promise<string> {
  const [row] = await sql`select status from public.exams where id = ${examId}`;
  return row.status as string;
}

/** One section, one math subject taught by the fixture "teacher", one english subject taught by an unrelated staff row, two enrolled students, a term. */
async function setupFixture(institutionId: string, teacherId: string) {
  await setExamSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(institutionId, { code: "ENG", name: "English" });
  await createSubjectAssignment(institutionId, sectionId, mathId, teacherId);

  const [otherStaff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  await createSubjectAssignment(institutionId, sectionId, englishId, otherStaff.id as string);

  const studentA = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const studentB = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(institutionId, studentA, sectionId, yearId);
  await createEnrolment(institutionId, studentB, sectionId, yearId);

  return { yearId, termId, gradeId, sectionId, mathId, englishId, studentA, studentB };
}

describe("exams module (T-018) — createExam/createExamPapers, status RPCs, enterMarks, verifyExam", () => {
  it("AC1: exam_controller creates an exam and bulk papers for sections x subjects in one action", async () => {
    const inst = await createTestInstitution("exams-create");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId, englishId } = await setupFixture(inst.institutionId, teacherId);
      const sectionB = await createClassSection(inst.institutionId, (await sql`select grade_id from public.class_sections where id=${sectionId}`)[0].grade_id, (await sql`select academic_year_id from public.terms where id=${termId}`)[0].academic_year_id, { name: "B" });

      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Unit Test 2 (demo)", type: "unit_test" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.status).toBe("draft");

      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [
          { classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionB, subjectId: mathId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionB, subjectId: englishId, maxMarks: 80, passMarks: 26.4 },
        ],
      });
      expect(papers).toMatchObject({ ok: true, data: { count: 4 } });

      const [{ count }] = await sql`select count(*)::int from public.exam_papers where exam_id = ${created.data.id}`;
      expect(count).toBe(4);
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from createExam/createExamPapers (no exam.manage)", async () => {
    const inst = await createTestInstitution("exams-teacher-forbidden-manage");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId } = await setupFixture(inst.institutionId, teacherId);
      const result = await callAs(inst, "teacher", createExam, { termId, name: "X", type: "unit_test" });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("openMarksEntry requires papers to exist, then draft->marks_entry; a teacher cannot open marks entry", async () => {
    const inst = await createTestInstitution("exams-open");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT1", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");

      const emptyOpen = await callAs(inst, "exam_controller", openMarksEntry, { examId: created.data.id });
      expect(emptyOpen).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });

      const forbidden = await callAs(inst, "teacher", openMarksEntry, { examId: created.data.id });
      expect(forbidden).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const opened = await callAs(inst, "exam_controller", openMarksEntry, { examId: created.data.id });
      expect(opened).toMatchObject({ ok: true, data: { status: "marks_entry" } });
      expect(await examStatus(created.data.id)).toBe("marks_entry");
    } finally {
      await inst.cleanup();
    }
  });

  it("J-09: a teacher enters marks for enrolled students (v1), changing a mark supersedes to v2, an unchanged resubmit creates no new version; verification lists missing then clean", async () => {
    const inst = await createTestInstitution("exams-j09");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId, studentA, studentB } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT2-X", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;

      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      if (!papers.ok) throw new Error("setup failed");

      const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${examId}`;
      const paperId = paperRow.id as string;

      await callAs(inst, "exam_controller", openMarksEntry, { examId });

      // Before any marks: verification lists both students missing.
      // (exam.manage is controller-only — verification is part of exam.manage, not exam.marks.enter.)
      const before = await callAs(inst, "exam_controller", verifyExam, { examId });
      expect(before.ok).toBe(true);
      if (before.ok) {
        expect(before.data.summary.clean).toBe(false);
        expect(before.data.summary.missingCount).toBe(2);
      }

      const entered = await callAs(inst, "teacher", enterMarks, {
        examPaperId: paperId,
        marks: [
          { studentId: studentA, marksObtained: 70, isAbsent: false },
          { studentId: studentB, marksObtained: 40, isAbsent: false },
        ],
      });
      expect(entered).toMatchObject({ ok: true, data: { entered: 2, unchanged: 0 } });

      const v1Rows = await sql`select version_no, superseded_by from public.marks where exam_paper_id = ${paperId} and student_id = ${studentA}`;
      expect(v1Rows).toHaveLength(1);
      expect(v1Rows[0].version_no).toBe(1);
      expect(v1Rows[0].superseded_by).toBeNull();

      // Resubmitting the exact same values creates no new version (06 §W7 "Duplicates").
      const resubmit = await callAs(inst, "teacher", enterMarks, {
        examPaperId: paperId,
        marks: [
          { studentId: studentA, marksObtained: 70, isAbsent: false },
          { studentId: studentB, marksObtained: 40, isAbsent: false },
        ],
      });
      expect(resubmit).toMatchObject({ ok: true, data: { entered: 0, unchanged: 2 } });

      // Changing one student's mark supersedes v1 with a new v2.
      const changed = await callAs(inst, "teacher", enterMarks, {
        examPaperId: paperId,
        marks: [{ studentId: studentA, marksObtained: 75, isAbsent: false }],
      });
      expect(changed).toMatchObject({ ok: true, data: { entered: 1, unchanged: 0 } });

      const studentARows = await sql`
        select version_no, superseded_by, marks_obtained from public.marks
        where exam_paper_id = ${paperId} and student_id = ${studentA} order by version_no
      `;
      expect(studentARows).toHaveLength(2);
      expect(studentARows[0]).toMatchObject({ version_no: 1 });
      expect(studentARows[0].superseded_by).not.toBeNull();
      expect(studentARows[1]).toMatchObject({ version_no: 2, marks_obtained: "75.00" });
      expect(studentARows[1].superseded_by).toBeNull();

      // Aggregate audit row with counts and ids only.
      const auditRows = await sql`select action, after from public.audit_events where entity_id = ${paperId}::uuid and action = 'exam.marks.entered' order by created_at`;
      expect(auditRows.length).toBeGreaterThanOrEqual(3);
      expect(auditRows[0].after).toMatchObject({ entered_count: 2, unchanged_count: 0 });

      const after = await callAs(inst, "exam_controller", verifyExam, { examId });
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.data.summary.clean).toBe(true);
        expect(after.data.summary.missingCount).toBe(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher who teaches the section for a DIFFERENT subject is forbidden to enter marks (subject-level scope, not section-level)", async () => {
    const inst = await createTestInstitution("exams-subject-scope");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, englishId, studentA } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT3", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");

      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 }],
      });
      await callAs(inst, "exam_controller", openMarksEntry, { examId: created.data.id });

      const [englishPaper] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;

      // The fixture "teacher" teaches math in this section, not english.
      const result = await callAs(inst, "teacher", enterMarks, {
        examPaperId: englishPaper.id as string,
        marks: [{ studentId: studentA, marksObtained: 50, isAbsent: false }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("marks above max are rejected with validation_failed; marks cannot be entered while the exam is draft", async () => {
    const inst = await createTestInstitution("exams-validation");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId, studentA } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT4", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");

      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      const [paper] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;

      // Still draft — openMarksEntry was never called.
      const draftAttempt = await callAs(inst, "teacher", enterMarks, {
        examPaperId: paper.id as string,
        marks: [{ studentId: studentA, marksObtained: 10, isAbsent: false }],
      });
      expect(draftAttempt).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      await callAs(inst, "exam_controller", openMarksEntry, { examId: created.data.id });

      const tooHigh = await callAs(inst, "teacher", enterMarks, {
        examPaperId: paper.id as string,
        marks: [{ studentId: studentA, marksObtained: 95, isAbsent: false }],
      });
      expect(tooHigh).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("closeMarksEntry (marks_entry->verification) and reopenMarksEntry (verification->marks_entry) follow the diagram", async () => {
    const inst = await createTestInstitution("exams-transitions");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT5", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      await callAs(inst, "exam_controller", openMarksEntry, { examId: created.data.id });

      const wrongState = await callAs(inst, "exam_controller", reopenMarksEntry, { examId: created.data.id });
      expect(wrongState).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      const closed = await callAs(inst, "exam_controller", closeMarksEntry, { examId: created.data.id });
      expect(closed).toMatchObject({ ok: true, data: { status: "verification" } });
      expect(await examStatus(created.data.id)).toBe("verification");

      const reopened = await callAs(inst, "exam_controller", reopenMarksEntry, { examId: created.data.id });
      expect(reopened).toMatchObject({ ok: true, data: { status: "marks_entry" } });
      expect(await examStatus(created.data.id)).toBe("marks_entry");
    } finally {
      await inst.cleanup();
    }
  });

  it("app.guard_exam_status: a direct RLS UPDATE of exams.status (bypassing the RPCs) is rejected, including backwards out of published", async () => {
    const inst = await createTestInstitution("exams-guard-bypass");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId, studentA, studentB } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT6", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;
      await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });

      // Direct update while draft, via the real authenticated client (RLS path, not the superuser test connection).
      const controllerClient = inst.clientAs("exam_controller");
      const { error: directError } = await controllerClient.from("exams").update({ status: "published" }).eq("id", examId);
      expect(directError).toBeTruthy();
      expect(String(directError?.message)).toContain("code:invalid_state");
      expect(await examStatus(examId)).toBe("draft");

      // Take the exam all the way to published via the real RPCs, then try a direct backwards write.
      await callAs(inst, "exam_controller", openMarksEntry, { examId });
      const [paper] = await sql`select id from public.exam_papers where exam_id = ${examId}`;
      await callAs(inst, "teacher", enterMarks, {
        examPaperId: paper.id as string,
        marks: [
          { studentId: studentA, marksObtained: 70, isAbsent: false },
          { studentId: studentB, marksObtained: 40, isAbsent: false },
        ],
      });
      await callAs(inst, "exam_controller", closeMarksEntry, { examId });
      const { error: publishError } = await controllerClient.rpc("publish_exam_results", { p_exam_id: examId });
      expect(publishError).toBeFalsy();
      expect(await examStatus(examId)).toBe("published");

      const { error: backwardsError } = await controllerClient.from("exams").update({ status: "marks_entry" }).eq("id", examId);
      expect(backwardsError).toBeTruthy();
      expect(await examStatus(examId)).toBe("published");
    } finally {
      await inst.cleanup();
    }
  });

  it("Fix round 1 (LOW): getPaperMarks hides a paper from a teacher with no subject_assignments row for it, even though it's visible to exam managers", async () => {
    const inst = await createTestInstitution("exams-paper-scope");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, englishId } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT7", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      // The fixture "teacher" teaches math in this section, not english.
      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 }],
      });
      const [englishPaper] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;

      const teacherCtx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      let teacherResult;
      try {
        teacherResult = await getPaperMarks(teacherCtx, englishPaper.id as string);
      } finally {
        setActingClient(null);
      }
      expect(teacherResult).toBeNull();

      const controllerCtx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller") as unknown as SupabaseClient<Database>);
      let controllerResult;
      try {
        controllerResult = await getPaperMarks(controllerCtx, englishPaper.id as string);
      } finally {
        setActingClient(null);
      }
      expect(controllerResult).not.toBeNull();
      expect(controllerResult?.paperId).toBe(englishPaper.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("Fix round 1: createExamPapers maps a duplicate (section, subject) pair to validation_failed, not internal", async () => {
    const inst = await createTestInstitution("exams-duplicate-paper");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId } = await setupFixture(inst.institutionId, teacherId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT8", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");

      const first = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      expect(first.ok).toBe(true);

      const duplicate = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      expect(duplicate).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("Fix round 1: enterMarks against another institution's paper/student returns not_found, not a cross-tenant leak", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const teacherIdA = await teacherStaffId(instA.institutionId);
      const { termId: termIdA, sectionId: sectionIdA, mathId: mathIdA, studentA: studentIdA } = await setupFixture(
        instA.institutionId,
        teacherIdA,
      );
      const examA = await callAs(instA, "exam_controller", createExam, { termId: termIdA, name: "PT9-A", type: "unit_test" });
      if (!examA.ok) throw new Error("setup failed");
      await callAs(instA, "exam_controller", createExamPapers, {
        examId: examA.data.id,
        papers: [{ classSectionId: sectionIdA, subjectId: mathIdA, maxMarks: 80, passMarks: 26.4 }],
      });
      await callAs(instA, "exam_controller", openMarksEntry, { examId: examA.data.id });
      const [paperA] = await sql`select id from public.exam_papers where exam_id = ${examA.data.id}`;

      const teacherIdB = await teacherStaffId(instB.institutionId);
      const { termId: termIdB, sectionId: sectionIdB, mathId: mathIdB, studentA: studentIdB } = await setupFixture(
        instB.institutionId,
        teacherIdB,
      );
      const examB = await callAs(instB, "exam_controller", createExam, { termId: termIdB, name: "PT9-B", type: "unit_test" });
      if (!examB.ok) throw new Error("setup failed");
      await callAs(instB, "exam_controller", createExamPapers, {
        examId: examB.data.id,
        papers: [{ classSectionId: sectionIdB, subjectId: mathIdB, maxMarks: 80, passMarks: 26.4 }],
      });
      await callAs(instB, "exam_controller", openMarksEntry, { examId: examB.data.id });
      const [paperB] = await sql`select id from public.exam_papers where exam_id = ${examB.data.id}`;

      // instB's teacher tries to enter marks against instA's paper (through instB's own context/RLS client).
      const crossPaper = await callAs(instB, "teacher", enterMarks, {
        examPaperId: paperA.id as string,
        marks: [{ studentId: studentIdB, marksObtained: 50, isAbsent: false }],
      });
      expect(crossPaper).toMatchObject({ ok: false, error: { code: "not_found" } });

      // instB's teacher enters marks for instA's student against instB's own
      // (otherwise valid) paper — app.enter_marks has no row to 404 on here
      // (the paper IS instB's), so this is caught by the enrolment check
      // instead (instA's student has no active enrolment in instB), not a
      // not_found lookup. Same security property either way: no cross-tenant
      // leak, no write.
      const crossStudent = await callAs(instB, "teacher", enterMarks, {
        examPaperId: paperB.id as string,
        marks: [{ studentId: studentIdA, marksObtained: 50, isAbsent: false }],
      });
      expect(crossStudent).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    });
  });
});
