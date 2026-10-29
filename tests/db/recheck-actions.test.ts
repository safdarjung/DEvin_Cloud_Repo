import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import {
  createExam,
  createExamPapers,
  decideRecheck,
  enterMarks,
  openMarksEntry,
  publishExamResults,
  requestRecheck,
  startRecheckReview,
} from "@/modules/exams/actions";
import { notifyRecheckDecided } from "@/modules/jobs/handlers/index";
import { DEFAULT_GRADING_BANDS } from "@/modules/exams/grade";
import { getCurrentResult, getResultHistory } from "@/modules/exams/queries";
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
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function setExamSettings(institutionId: string, recheckWindowDays = 7): Promise<void> {
  const patch = {
    locale: { timezone: "Asia/Kolkata", currency: "INR" },
    exams: { pass_percentage: 33, grading_scales: { default: DEFAULT_GRADING_BANDS }, recheck_window_days: recheckWindowDays },
  };
  await sql`
    update public.institutions
    set settings = settings || ${sql.json(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patch as any,
    )}
    where id = ${institutionId}
  `;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** One section, two subjects, a teacher assigned to both, a published exam for `studentA` (the fixture's own "student"/"guardian" roles — linked via guardian_students) and `studentB` (unrelated, no guardian link). */
async function setupPublishedFixture(inst: TestInstitution) {
  await setExamSettings(inst.institutionId);
  const teacherId = await teacherStaffId(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  const mathId = await createSubject(inst.institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(inst.institutionId, { code: "ENG", name: "English" });
  await createSubjectAssignment(inst.institutionId, sectionId, mathId, teacherId);
  await createSubjectAssignment(inst.institutionId, sectionId, englishId, teacherId);

  const [studentAMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentA = studentAMembership.student_id as string;
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentA}, 'father', true)
  `;
  const studentB = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(inst.institutionId, studentA, sectionId, yearId);
  await createEnrolment(inst.institutionId, studentB, sectionId, yearId);

  const created = await callAs(inst, "exam_controller", createExam, { termId, name: `Recheck fixture ${crypto.randomUUID().slice(0, 6)}`, type: "unit_test" });
  if (!created.ok) throw new Error("setup failed: createExam");
  const examId = created.data.id;

  const papers = await callAs(inst, "exam_controller", createExamPapers, {
    examId,
    papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 100, passMarks: 33 }],
  });
  if (!papers.ok) throw new Error("setup failed: createExamPapers");
  const [paper] = await sql`select id from public.exam_papers where exam_id = ${examId} and subject_id = ${mathId}`;
  const mathPaperId = paper.id as string;

  await callAs(inst, "exam_controller", openMarksEntry, { examId });
  await callAs(inst, "teacher", enterMarks, {
    examPaperId: mathPaperId,
    marks: [
      { studentId: studentA, marksObtained: 70, isAbsent: false },
      { studentId: studentB, marksObtained: 60, isAbsent: false },
    ],
  });
  await sql`update public.exams set status = 'verification' where id = ${examId}`;
  const published = await callAs(inst, "exam_controller", publishExamResults, { examId });
  if (!published.ok) throw new Error("setup failed: publishExamResults");

  const [resultA] = await sql`select id from public.results where exam_id = ${examId} and student_id = ${studentA}`;
  const [resultB] = await sql`select id from public.results where exam_id = ${examId} and student_id = ${studentB}`;

  return { examId, mathPaperId, studentA, studentB, resultAId: resultA.id as string, resultBId: resultB.id as string };
}

describe("recheck workflow (T-020) — requestRecheck/startRecheckReview/decideRecheck", () => {
  it("full happy path: guardian requests, controller reviews and approves, report card + history + notification reflect the correction", async () => {
    const inst = await createTestInstitution("recheck-happy");
    try {
      const fx = await setupPublishedFixture(inst);

      const requested = await callAs(inst, "guardian", requestRecheck, {
        resultId: fx.resultAId,
        examPaperId: fx.mathPaperId,
        reason: "The addition on question 4 looks miscounted, please recheck.",
      });
      expect(requested).toMatchObject({ ok: true, data: { status: "submitted" } });
      if (!requested.ok) throw new Error("unreachable");
      const requestId = requested.data.request_id;

      // A teacher never holds exam.recheck.review (07 §2.2) — forbidden.
      const teacherReview = await callAs(inst, "teacher", startRecheckReview, { requestId });
      expect(teacherReview).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const review = await callAs(inst, "exam_controller", startRecheckReview, { requestId });
      expect(review).toMatchObject({ ok: true, data: { status: "under_review" } });

      const decided = await callAs(inst, "exam_controller", decideRecheck, {
        requestId,
        decision: "approve",
        newMarks: 78,
        note: "Re-totalled on recheck.",
      });
      expect(decided).toMatchObject({ ok: true, data: { decision: "approve" } });

      const [requestRow] = await sql`select status from public.recheck_requests where id = ${requestId}`;
      expect(requestRow.status).toBe("applied");

      // Report card (ReportCard's own query) now shows the corrected marks.
      const guardianCtx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      try {
        const current = await getCurrentResult(guardianCtx, fx.examId, fx.studentA);
        expect(current?.isCorrected).toBe(true);
        const mathSubject = current?.subjects.find((s) => s.examPaperId === fx.mathPaperId);
        expect(mathSubject?.marksObtained).toBe(78);
      } finally {
        setActingClient(null);
      }

      // Version history — exam roles only.
      const controllerCtx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller") as unknown as SupabaseClient<Database>);
      try {
        const history = await getResultHistory(controllerCtx, fx.examId, fx.studentA);
        expect(history).toHaveLength(2);
        expect(history?.map((h) => h.versionNo).sort()).toEqual([1, 2]);
      } finally {
        setActingClient(null);
      }

      // AC3: a recheck_decided notification for the requesting guardian.
      const job = await sql`
        select payload from public.jobs where institution_id = ${inst.institutionId}::uuid and idempotency_key = ${"recheck:" + requestId}
      `;
      expect(job).toHaveLength(1);
      await notifyRecheckDecided(
        {
          id: "job-1",
          institution_id: inst.institutionId,
          type: "notify.recheck_decided",
          payload: job[0].payload as Record<string, unknown>,
          idempotency_key: "recheck:" + requestId,
          status: "running",
          attempts: 1,
          max_attempts: 5,
          run_after: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { admin: admin as any },
      );
      const notifications = await sql`
        select recipient_user_id, body from public.notifications
        where institution_id = ${inst.institutionId}::uuid and type = 'recheck_decided'
      `;
      expect(notifications).toHaveLength(1);
      expect(notifications[0].recipient_user_id).toBe(inst.users.guardian.id);
      expect(notifications[0].body).toContain("78");
    } finally {
      await inst.cleanup();
    }
  });

  it("reject path leaves marks/results unchanged and still records the decision", async () => {
    const inst = await createTestInstitution("recheck-reject");
    try {
      const fx = await setupPublishedFixture(inst);
      const requested = await callAs(inst, "guardian", requestRecheck, {
        resultId: fx.resultAId,
        examPaperId: fx.mathPaperId,
        reason: "Please double check the total on this paper for me.",
      });
      if (!requested.ok) throw new Error("setup failed");
      await callAs(inst, "exam_controller", startRecheckReview, { requestId: requested.data.request_id });

      const decided = await callAs(inst, "exam_controller", decideRecheck, {
        requestId: requested.data.request_id,
        decision: "reject",
        note: "Totals are correct as published.",
      });
      expect(decided).toMatchObject({ ok: true, data: { decision: "reject" } });

      const [requestRow] = await sql`select status from public.recheck_requests where id = ${requested.data.request_id}`;
      expect(requestRow.status).toBe("rejected");

      const [{ count: resultVersions }] = await sql`
        select count(*)::int as count from public.results where exam_id = ${fx.examId} and student_id = ${fx.studentA}
      `;
      expect(resultVersions).toBe(1);

      const [{ count: decisionCount }] = await sql`
        select count(*)::int as count from public.recheck_decisions where request_id = ${requested.data.request_id} and decision = 'reject'
      `;
      expect(decisionCount).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("direct PostgREST RPC: one open request per (result, paper) is enforced by the RPC itself (conflict), not left to the action layer", async () => {
    const inst = await createTestInstitution("recheck-conflict");
    try {
      const fx = await setupPublishedFixture(inst);
      const first = await inst.clientAs("guardian").rpc("request_recheck", {
        p_institution_id: inst.institutionId,
        p_result_id: fx.resultAId,
        p_exam_paper_id: fx.mathPaperId,
        p_reason: "First request — please recheck this paper's total.",
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("guardian").rpc("request_recheck", {
        p_institution_id: inst.institutionId,
        p_result_id: fx.resultAId,
        p_exam_paper_id: fx.mathPaperId,
        p_reason: "Second request — same paper, still open.",
      });
      expect(second.error?.message).toBe("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("direct PostgREST RPC: a request after the recheck window has closed is invalid_state", async () => {
    const inst = await createTestInstitution("recheck-window");
    try {
      await setExamSettings(inst.institutionId, 1);
      const fx = await setupPublishedFixture(inst);

      // `app.results_guard` (0009) blocks any direct UPDATE of a published
      // `results` row's `published_at` (only `superseded_by` may ever
      // change, no bypass for a plain backdate) — a backdated row has to be
      // its own fresh INSERT instead, which the guard never touches (BEFORE
      // UPDATE OR DELETE only). Reuses studentB's already-published math
      // paper and snapshot shape, inserted as its own version_no=1 row
      // against a second, otherwise-unused exam id so it never collides
      // with fx's own unique(exam_id, student_id, version_no).
      const [secondExam] = await sql`
        insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
        values (
          ${inst.institutionId},
          (select academic_year_id from public.exams where id = ${fx.examId}),
          (select term_id from public.exams where id = ${fx.examId}),
          'Recheck window fixture', 'unit_test', 'published'
        )
        returning id
      `;
      const [secondPaper] = await sql`
        insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
        select ${inst.institutionId}, ${secondExam.id}, class_section_id, subject_id, max_marks, pass_marks
        from public.exam_papers where id = ${fx.mathPaperId}
        returning id
      `;
      const [backdated] = await sql`
        insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
        values (
          ${inst.institutionId}, ${secondExam.id}, ${fx.studentB},
          '{"subjects": [], "attendancePercentage": 0}'::jsonb, 60, 100, 60, 'B2', 1, now() - interval '10 days'
        )
        returning id
      `;

      // studentB has no guardian link in this fixture — filed as
      // exam_controller instead (authorized by app.exam_write_roles(), 06
      // §W8's "controller filing on behalf"), isolating the window check
      // from the ownership check exercised by the next test.
      const asController = await inst.clientAs("exam_controller").rpc("request_recheck", {
        p_institution_id: inst.institutionId,
        p_result_id: backdated.id,
        p_exam_paper_id: secondPaper.id,
        p_reason: "Filing on behalf — this result's recheck window has already closed.",
      });
      expect(asController.error?.message).toBe("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("direct PostgREST RPC: a guardian cannot request a recheck for a result that isn't their own child's (not_found)", async () => {
    const inst = await createTestInstitution("recheck-ownership");
    try {
      const fx = await setupPublishedFixture(inst);
      const attempt = await inst.clientAs("guardian").rpc("request_recheck", {
        p_institution_id: inst.institutionId,
        p_result_id: fx.resultBId,
        p_exam_paper_id: fx.mathPaperId,
        p_reason: "This is not my child but I am trying anyway.",
      });
      expect(attempt.error?.message).toBe("code:not_found");

      const [{ count }] = await sql`select count(*)::int as count from public.recheck_requests where result_id = ${fx.resultBId}`;
      expect(count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("direct PostgREST insert into recheck_requests is rejected outright — 0022 dropped the INSERT policy, app.request_recheck is the only path", async () => {
    const inst = await createTestInstitution("recheck-direct-insert");
    try {
      const fx = await setupPublishedFixture(inst);
      const { error } = await inst
        .clientAs("guardian")
        .from("recheck_requests")
        .insert({
          institution_id: inst.institutionId,
          result_id: fx.resultAId,
          exam_paper_id: fx.mathPaperId,
          requested_by: inst.users.guardian.id,
          reason: "Trying to bypass the window/duplicate checks via a direct insert.",
        });
      expect(error).not.toBeNull();

      const [{ count }] = await sql`select count(*)::int as count from public.recheck_requests where result_id = ${fx.resultAId}`;
      expect(count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });
});
