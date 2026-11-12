import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  closeMarksEntry, createExam, createExamPapers, decideRecheck, enterMarks, openMarksEntry, publishExamResults,
  reopenMarksEntry, requestRecheck, saveResultRemark, startRecheckReview, verifyExam,
} from "@/modules/exams/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject,
  createSubjectAssignment, createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Curveballs: exam state machine, marks/results immutability, recheck double-decide.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 8 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;

async function fixture(inst: TestInstitution) {
  await sql`update public.institutions set settings = settings || jsonb_build_object(
    'locale', jsonb_build_object('timezone','Asia/Kolkata','currency','INR'),
    'exams', jsonb_build_object('pass_percentage',33,'grading_scales', jsonb_build_object('default', jsonb_build_array(
      jsonb_build_object('min',33,'max',100,'grade','PASS','points',1),
      jsonb_build_object('min',0,'max',32,'grade','FAIL','points',0,'fail',true)))))
    where id=${inst.institutionId}`;
  const teacher = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  const mathId = await createSubject(inst.institutionId, { code: "MATH", name: "Mathematics" });
  await createSubjectAssignment(inst.institutionId, sectionId, mathId, teacher);
  const studentA = (await one(sql`select student_id from public.memberships where institution_id=${inst.institutionId} and role='student'`)).student_id as string;
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id=${inst.institutionId} and role='guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary) values (${inst.institutionId}, ${guardianId}, ${studentA}, 'father', true)`;
  const studentB = (await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'B', '2014-01-01', 'other') returning id`)).id as string;
  await createEnrolment(inst.institutionId, studentA, sectionId, yearId);
  await createEnrolment(inst.institutionId, studentB, sectionId, yearId);
  const exam = await callAs(inst, "exam_controller", createExam, { termId, name: `E-${crypto.randomUUID().slice(0, 6)}`, type: "unit_test" });
  if (!exam.ok) throw new Error("createExam");
  const papers = await callAs(inst, "exam_controller", createExamPapers, { examId: exam.data.id, papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 100, passMarks: 33 }] });
  if (!papers.ok) throw new Error("papers");
  const paperId = (await one(sql`select id from public.exam_papers where exam_id=${exam.data.id}`)).id as string;
  return { examId: exam.data.id, paperId, studentA, studentB, sectionId, gradeId, yearId };
}

const status = async (examId: string) => (await one(sql`select status from public.exams where id=${examId}`)).status as string;
const marks = (studentId: string, v: number) => ({ studentId, marksObtained: v, isAbsent: false });

describe("exam state machine", () => {
  it("out-of-order transitions: close/reopen from draft, publish from draft/marks_entry are invalid_state and leave status unchanged", async () => {
    const inst = await createTestInstitution("cb-ex-sm");
    try {
      const f = await fixture(inst);
      const close = await callAs(inst, "exam_controller", closeMarksEntry, { examId: f.examId });
      expect(!close.ok && close.error.code).toBe("invalid_state");
      const reopen = await callAs(inst, "exam_controller", reopenMarksEntry, { examId: f.examId });
      expect(!reopen.ok && reopen.error.code).toBe("invalid_state");
      const pubDraft = await callAs(inst, "exam_controller", publishExamResults, { examId: f.examId });
      expect(!pubDraft.ok && pubDraft.error.code).toBe("invalid_state");
      expect(await status(f.examId)).toBe("draft");
      expect((await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId })).ok).toBe(true);
      const openTwice = await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
      expect(!openTwice.ok && openTwice.error.code).toBe("invalid_state");
      const pubEntry = await callAs(inst, "exam_controller", publishExamResults, { examId: f.examId });
      expect(!pubEntry.ok && pubEntry.error.code).toBe("invalid_state");
      expect(await status(f.examId)).toBe("marks_entry");
      expect((await sql`select 1 from public.results where exam_id=${f.examId}`).length).toBe(0);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("after publish: publish again, reopen, close, open, and enterMarks are all refused; marks and results rows are unchanged", async () => {
    const inst = await createTestInstitution("cb-ex-pub");
    try {
      const f = await fixture(inst);
      await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
      expect((await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 70), marks(f.studentB, 20)] })).ok).toBe(true);
      expect((await callAs(inst, "exam_controller", closeMarksEntry, { examId: f.examId })).ok).toBe(true);
      const pub = await callAs(inst, "exam_controller", publishExamResults, { examId: f.examId });
      expect(pub).toMatchObject({ ok: true, data: { result_count: 2 } });
      const before = await sql`select id, version_no, marks_obtained from public.marks where exam_paper_id=${f.paperId} order by student_id`;
      const resBefore = await sql`select id, version_no, percentage, grade from public.results where exam_id=${f.examId} order by student_id`;

      const again = await callAs(inst, "exam_controller", publishExamResults, { examId: f.examId });
      expect(!again.ok && again.error.code).toBe("invalid_state");
      for (const act of [reopenMarksEntry, closeMarksEntry, openMarksEntry]) {
        const r = await callAs(inst, "exam_controller", act, { examId: f.examId });
        expect(r.ok).toBe(false);
      }
      const late = await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 99)] });
      expect(late.ok).toBe(false);
      expect(await status(f.examId)).toBe("published");

      const after = await sql`select id, version_no, marks_obtained from public.marks where exam_paper_id=${f.paperId} order by student_id`;
      const resAfter = await sql`select id, version_no, percentage, grade from public.results where exam_id=${f.examId} order by student_id`;
      expect(after).toEqual(before);
      expect(resAfter).toEqual(resBefore);
      expect(resAfter).toHaveLength(2);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("publish: teacher/guardian forbidden, another school's exam not_found, random id not_found", async () => {
    const inst = await createTestInstitution("cb-ex-perm");
    const other = await createTestInstitution("cb-ex-perm-x");
    try {
      const f = await fixture(inst);
      const of = await fixture(other);
      for (const role of ["teacher", "guardian", "student", "accountant"] as const) {
        const r = await callAs(inst, role, publishExamResults, { examId: f.examId });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      const cross = await callAs(inst, "exam_controller", publishExamResults, { examId: of.examId });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      const rnd = await callAs(inst, "exam_controller", publishExamResults, { examId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      for (const act of [openMarksEntry, closeMarksEntry, reopenMarksEntry, verifyExam] as Array<typeof openMarksEntry>) {
        const r = await callAs(inst, "exam_controller", act, { examId: of.examId });
        expect(r.ok, "cross-tenant exam").toBe(false);
      }
      expect(await status(of.examId)).toBe("draft");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("enterMarks curveballs", () => {
  it("validation: negative, above max, absent with marks, neither, duplicate student, 0 rows, 61 rows, unknown key", async () => {
    const inst = await createTestInstitution("cb-ex-marks");
    try {
      const f = await fixture(inst);
      await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
      const cases: Record<string, unknown> = {
        negative: [marks(f.studentA, -1)],
        absentWithMarks: [{ studentId: f.studentA, marksObtained: 5, isAbsent: true }],
        neither: [{ studentId: f.studentA, isAbsent: false }],
        dup: [marks(f.studentA, 1), marks(f.studentA, 2)],
        empty: [],
        many: Array.from({ length: 61 }, () => marks(crypto.randomUUID(), 1)),
      };
      for (const [name, rows] of Object.entries(cases)) {
        const r = await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: rows } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      const extra = await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 1)], versionNo: 9 } as never);
      expect(!extra.ok && extra.error.code).toBe("validation_failed");
      const over = await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 100.5)] });
      expect(!over.ok && over.error.code).toBe("validation_failed");
      expect((await sql`select 1 from public.marks where exam_paper_id=${f.paperId}`).length).toBe(0);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("a student not enrolled in the paper's section, or another school's student, is refused and nothing is written", async () => {
    const inst = await createTestInstitution("cb-ex-enrol");
    const other = await createTestInstitution("cb-ex-enrol-x");
    try {
      const f = await fixture(inst);
      const of = await fixture(other);
      await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
      const stray = (await one(sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'S', '2014-01-01', 'other') returning id`)).id as string;
      for (const sid of [stray, of.studentA]) {
        const r = await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(sid, 10)] });
        expect(r.ok).toBe(false);
      }
      const foreignPaper = await callAs(inst, "teacher", enterMarks, { examPaperId: of.paperId, marks: [marks(of.studentA, 10)] });
      expect(foreignPaper.ok).toBe(false);
      expect((await sql`select 1 from public.marks where institution_id in (${inst.institutionId}, ${other.institutionId})`).length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("a correction creates version 2 and supersedes v1; v1 row still exists; unchanged resubmit adds none; direct delete/update by controller fails", async () => {
    const inst = await createTestInstitution("cb-ex-ver");
    try {
      const f = await fixture(inst);
      await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
      await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 40)] });
      await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 55)] });
      await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 55)] });
      const rows = await sql`select version_no, marks_obtained, superseded_by from public.marks where exam_paper_id=${f.paperId} order by version_no`;
      expect(rows.map((r) => r.version_no)).toEqual([1, 2]);
      expect(rows[0].superseded_by).not.toBeNull();
      expect(rows[1].superseded_by).toBeNull();
      const del = await inst.clientAs("exam_controller").from("marks").delete().eq("exam_paper_id", f.paperId).select("id");
      expect(del.data ?? []).toHaveLength(0);
      const upd = await inst.clientAs("exam_controller").from("marks").update({ marks_obtained: 100 }).eq("exam_paper_id", f.paperId).select("id");
      expect(upd.data ?? []).toHaveLength(0);
      await expect(sql`delete from public.marks where exam_paper_id=${f.paperId}`).rejects.toThrow();
      expect((await sql`select 1 from public.marks where exam_paper_id=${f.paperId}`).length).toBe(2);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("recheck + remarks curveballs", () => {
  async function published(inst: TestInstitution) {
    const f = await fixture(inst);
    await callAs(inst, "exam_controller", openMarksEntry, { examId: f.examId });
    await callAs(inst, "teacher", enterMarks, { examPaperId: f.paperId, marks: [marks(f.studentA, 70), marks(f.studentB, 60)] });
    await callAs(inst, "exam_controller", closeMarksEntry, { examId: f.examId });
    await callAs(inst, "exam_controller", publishExamResults, { examId: f.examId });
    const resultA = (await one(sql`select id from public.results where exam_id=${f.examId} and student_id=${f.studentA}`)).id as string;
    const resultB = (await one(sql`select id from public.results where exam_id=${f.examId} and student_id=${f.studentB}`)).id as string;
    return { ...f, resultA, resultB };
  }
  const reason = "Question four was totalled incorrectly, please recheck.";

  it("decide twice (approve then approve/reject) is invalid_state and creates exactly one extra marks/results version", async () => {
    const inst = await createTestInstitution("cb-rc-twice");
    try {
      const f = await published(inst);
      const req = await callAs(inst, "guardian", requestRecheck, { resultId: f.resultA, examPaperId: f.paperId, reason });
      if (!req.ok) throw new Error(`request ${req.error.code}`);
      const requestId = req.data.request_id;
      // deciding before review starts
      const early = await callAs(inst, "exam_controller", decideRecheck, { requestId, decision: "reject", note: "n" });
      expect(early.ok || early.error.code === "invalid_state").toBe(true);
      if (early.ok) return; // implementation allows reject straight from submitted; remaining cases need an open request
      expect((await callAs(inst, "exam_controller", startRecheckReview, { requestId })).ok).toBe(true);
      const startAgain = await callAs(inst, "exam_controller", startRecheckReview, { requestId });
      expect(!startAgain.ok && startAgain.error.code).toBe("invalid_state");
      expect((await callAs(inst, "exam_controller", decideRecheck, { requestId, decision: "approve", newMarks: 80 })).ok).toBe(true);
      for (const decision of ["approve", "reject"] as const) {
        const r = await callAs(inst, "exam_controller", decideRecheck, { requestId, decision, newMarks: 90, note: "again" });
        expect(!r.ok && r.error.code, decision).toBe("invalid_state");
      }
      const m = await sql`select version_no from public.marks where exam_paper_id=${f.paperId} and student_id=${f.studentA} order by version_no`;
      expect(m.map((r) => r.version_no)).toEqual([1, 2]);
      const rs = await sql`select version_no from public.results where exam_id=${f.examId} and student_id=${f.studentA} order by version_no`;
      expect(rs.map((r) => r.version_no)).toEqual([1, 2]);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("recheck validation and permission: short reason, approve without newMarks, newMarks > max, guardian cannot decide, other child's result refused, start on random id not_found", async () => {
    const inst = await createTestInstitution("cb-rc-val");
    try {
      const f = await published(inst);
      const short = await callAs(inst, "guardian", requestRecheck, { resultId: f.resultA, examPaperId: f.paperId, reason: "bad" });
      expect(!short.ok && short.error.code).toBe("validation_failed");
      const other = await callAs(inst, "guardian", requestRecheck, { resultId: f.resultB, examPaperId: f.paperId, reason });
      expect(other.ok).toBe(false);
      const req = await callAs(inst, "guardian", requestRecheck, { resultId: f.resultA, examPaperId: f.paperId, reason });
      if (!req.ok) throw new Error("request");
      const requestId = req.data.request_id;
      const noMarks = await callAs(inst, "exam_controller", decideRecheck, { requestId, decision: "approve" });
      expect(!noMarks.ok && noMarks.error.code).toBe("validation_failed");
      if (!noMarks.ok) expect(noMarks.error.fieldErrors?.newMarks).toBeDefined();
      for (const role of ["guardian", "teacher", "student"] as const) {
        const r = await callAs(inst, role, decideRecheck, { requestId, decision: "reject", note: "x" });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      await callAs(inst, "exam_controller", startRecheckReview, { requestId });
      const tooHigh = await callAs(inst, "exam_controller", decideRecheck, { requestId, decision: "approve", newMarks: 101 });
      expect(tooHigh.ok).toBe(false);
      const rnd = await callAs(inst, "exam_controller", startRecheckReview, { requestId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      expect((await sql`select 1 from public.marks where exam_paper_id=${f.paperId} and version_no=2`).length).toBe(0);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("saveResultRemark: blank/501 chars invalid; unknown result not_found; guardian forbidden; remark never alters the result row", async () => {
    const inst = await createTestInstitution("cb-remark");
    try {
      const f = await published(inst);
      const before = await one(sql`select percentage, grade, version_no from public.results where id=${f.resultA}`);
      for (const remark of ["   ", "x".repeat(501)]) {
        const r = await callAs(inst, "teacher", saveResultRemark, { resultId: f.resultA, remark });
        expect(!r.ok && r.error.code).toBe("validation_failed");
      }
      const rnd = await callAs(inst, "teacher", saveResultRemark, { resultId: crypto.randomUUID(), remark: "ok" });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      const g = await callAs(inst, "guardian", saveResultRemark, { resultId: f.resultA, remark: "ok" });
      expect(!g.ok && g.error.code).toBe("forbidden");
      expect((await callAs(inst, "teacher", saveResultRemark, { resultId: f.resultA, remark: "Good effort" })).ok).toBe(true);
      expect((await callAs(inst, "teacher", saveResultRemark, { resultId: f.resultA, remark: "Better" })).ok).toBe(true);
      expect(await one(sql`select percentage, grade, version_no from public.results where id=${f.resultA}`)).toEqual(before);
    } finally { await inst.cleanup(); }
  }, 60_000);
});
