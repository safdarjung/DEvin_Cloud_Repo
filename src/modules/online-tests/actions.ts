"use server";

// Phase 4 (15-learning-exam-system-plan.md) — online tests. Every rule that
// matters lives in SQL (0150): RLS + app.online_test_guard scope test edits,
// public.transition_online_test moves status, and the student/marking
// functions check owner, window, deadline (+30 s grace), attempt limit and
// marker scope. These actions validate input, call them, and audit what SQL
// does not. Rule 6: suggestMarks writes only ai_suggested_* through
// save_test_ai_suggestion; teacher_marks come only from saveMarks. Official
// marks reach the exam only through public.enter_marks (pushToMarksEntry).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { aiTaskOn } from "@/modules/ai/task-route";
import {
  buildMarkingPrompt,
  MARKING_INSTRUCTIONS,
  MarkingSuggestionSchema,
  roundSuggestion,
} from "@/modules/online-tests/marking";
import { queueItem } from "@/modules/online-tests/queries";
import {
  AttemptIdSchema,
  AttemptStartSchema,
  ResponseIdSchema,
  SaveMarksSchema,
  SaveResponseSchema,
  TestCreateSchema,
  TestIdSchema,
  TestUpdateSchema,
  type TestStatus,
} from "@/modules/online-tests/schemas";

const MODULE = "exams" as const;
const ENTER_MARKS_BATCH = 60; // app.enter_marks accepts 1..60 rows per call

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function loadPaper(db: Db, ctx: TenantContext, paperId: string) {
  const { data, error } = await db
    .from("question_papers")
    .select("current_version, grade_id, subject_id")
    .eq("id", paperId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Paper not found among the papers you can use.");
  if (data.current_version < 1) throw new AppError("invalid_state", "Approve the paper before giving it as a test.");
  return data;
}

export const createTest = defineAction({
  name: "onlineTests.create",
  schema: TestCreateSchema,
  module: MODULE,
  permission: "online_test.manage",
  handler: async (input, ctx) => {
    const db = await createClient();
    const paper = await loadPaper(db, ctx, input.questionPaperId);
    const { data, error } = await db
      .from("online_tests")
      .insert({
        institution_id: ctx.institution.id,
        question_paper_id: input.questionPaperId,
        paper_version_no: input.paperVersionNo ?? paper.current_version,
        // app.online_test_guard re-copies these from the paper.
        grade_id: paper.grade_id,
        subject_id: paper.subject_id,
        title: input.title,
        section_ids: input.sectionIds,
        opens_at: input.opensAt,
        closes_at: input.closesAt,
        duration_minutes: input.durationMinutes,
        max_attempts: input.maxAttempts,
        shuffle: input.shuffle,
        show_results: input.showResults,
        show_answers: input.showAnswers,
        practice: input.practice,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "online_test.create", entityType: "online_test", entityId: data.id, after: { title: input.title, practice: input.practice } });
    return { id: data.id };
  },
});

export const updateTest = defineAction({
  name: "onlineTests.update",
  schema: TestUpdateSchema,
  module: MODULE,
  permission: "online_test.manage",
  handler: async ({ id, ...p }, ctx) => {
    const db = await createClient();
    const patch = {
      ...(p.title !== undefined && { title: p.title }),
      ...(p.paperVersionNo !== undefined && { paper_version_no: p.paperVersionNo }),
      ...(p.sectionIds !== undefined && { section_ids: p.sectionIds }),
      ...(p.opensAt !== undefined && { opens_at: p.opensAt }),
      ...(p.closesAt !== undefined && { closes_at: p.closesAt }),
      ...(p.durationMinutes !== undefined && { duration_minutes: p.durationMinutes }),
      ...(p.maxAttempts !== undefined && { max_attempts: p.maxAttempts }),
      ...(p.shuffle !== undefined && { shuffle: p.shuffle }),
      ...(p.showResults !== undefined && { show_results: p.showResults }),
      ...(p.showAnswers !== undefined && { show_answers: p.showAnswers }),
      ...(p.practice !== undefined && { practice: p.practice }),
    };
    if (Object.keys(patch).length === 0) throw new AppError("validation_failed", "Nothing to change.");
    const { data, error } = await db.from("online_tests").update(patch).eq("id", id).eq("institution_id", ctx.institution.id).select("id");
    if (error) throwMapped(error);
    if (data.length === 0) throw new AppError("not_found", "Test not found, or you cannot change it.");
    await audit(ctx, { action: "online_test.update", entityType: "online_test", entityId: id, after: { fields: Object.keys(patch) } });
    return { id };
  },
});

async function transition(id: string, to: TestStatus): Promise<{ id: string; status: TestStatus }> {
  const db = await createClient();
  const { error } = await db.rpc("transition_online_test", { p_test_id: id, p_to: to });
  if (error) throwMapped(error);
  return { id, status: to };
}

export const scheduleTest = defineAction({
  name: "onlineTests.schedule",
  schema: TestIdSchema,
  module: MODULE,
  permission: "online_test.manage",
  handler: ({ id }) => transition(id, "scheduled"),
});

export const cancelTest = defineAction({
  name: "onlineTests.cancel",
  schema: TestIdSchema,
  module: MODULE,
  permission: "online_test.manage",
  handler: ({ id }) => transition(id, "cancelled"),
});

export const closeTest = defineAction({
  name: "onlineTests.close",
  schema: TestIdSchema,
  module: MODULE,
  permission: "online_test.manage",
  handler: ({ id }) => transition(id, "closed"),
});

export const publishTestResults = defineAction({
  name: "onlineTests.results.publish",
  schema: TestIdSchema,
  module: MODULE,
  permission: "online_test.publish",
  handler: ({ id }) => transition(id, "published"),
});

// ── Student ──

export const startAttempt = defineAction({
  name: "onlineTests.attempt.start",
  schema: AttemptStartSchema,
  module: MODULE,
  permission: "online_test.take",
  handler: async ({ testId, clientInfo }) => {
    const db = await createClient();
    const { data, error } = await db.rpc("start_test_attempt", { p_test_id: testId, p_client_info: (clientInfo ?? null) as Json });
    if (error) throwMapped(error);
    return data as unknown as { attemptId: string; deadline: string; serverNow: string; resumed: boolean };
  },
});

export const saveResponse = defineAction({
  name: "onlineTests.attempt.saveResponse",
  schema: SaveResponseSchema,
  module: MODULE,
  permission: "online_test.take",
  handler: async ({ attemptId, itemKey, answer, flagged }) => {
    const db = await createClient();
    const { data, error } = await db.rpc("save_test_response", {
      p_attempt_id: attemptId,
      p_item_key: itemKey,
      p_answer: answer as Json,
      p_flagged: flagged,
    });
    if (error) throwMapped(error);
    const result = data as unknown as { status: "saved" | "expired"; savedAt?: string };
    if (result.status === "expired") throw new AppError("invalid_state", "Time is up. Your answers were submitted.");
    return { savedAt: result.savedAt as string };
  },
});

export const submitAttempt = defineAction({
  name: "onlineTests.attempt.submit",
  schema: AttemptIdSchema,
  module: MODULE,
  permission: "online_test.take",
  handler: async ({ attemptId }) => {
    const db = await createClient();
    const { data, error } = await db.rpc("submit_test_attempt", { p_attempt_id: attemptId });
    if (error) throwMapped(error);
    return data as unknown as { status: string; submittedAt: string | null };
  },
});

// ── Marking ──

export const suggestMarks = defineAction({
  name: "onlineTests.marking.suggest",
  schema: ResponseIdSchema,
  module: MODULE,
  permission: "online_test.mark",
  handler: async ({ responseId }, ctx) => {
    const item = await queueItem(ctx, responseId);
    if (!aiTaskOn(ctx, "answer_marking")) throw new AppError("forbidden", "AI marking suggestions are turned off for your role.");
    const generated = await runStructured({
      ctx,
      feature: "online_test_marking",
      // Never under local_only (rule 6). The prompt carries no name; the student's name is redacted anyway on the cloud path.
      agentCloud: ctx.institution.ai_policy !== "local_only",
      denyNames: item.studentName ? [item.studentName] : undefined,
      schema: MarkingSuggestionSchema,
      instructions: MARKING_INSTRUCTIONS,
      prompt: buildMarkingPrompt({
        question: item.body,
        maxMarks: item.marks,
        markingScheme: item.markingScheme,
        expectedAnswer: item.expectedAnswer,
        studentAnswer: item.answer,
      }),
      maxOutputTokens: 600,
    });
    if (!generated.ok) throw new AppError(generated.error.code, generated.error.message);
    const marks = roundSuggestion(generated.data.data.marks, item.marks);
    const feedback = generated.data.data.feedback;
    const db = await createClient();
    const { error } = await db.rpc("save_test_ai_suggestion", { p_response_id: responseId, p_marks: marks, p_feedback: feedback });
    if (error) throwMapped(error);
    await audit(ctx, {
      action: "online_test.marks.suggested",
      entityType: "test_response",
      entityId: responseId,
      after: { aiSuggestedMarks: marks },
      metadata: { provider: generated.data.provider, model: generated.data.model },
    });
    return { responseId, aiSuggestedMarks: marks, aiFeedback: feedback, provider: generated.data.provider, model: generated.data.model };
  },
});

export const saveMarks = defineAction({
  name: "onlineTests.marking.save",
  schema: SaveMarksSchema,
  module: MODULE,
  permission: "online_test.mark",
  handler: async ({ responseId, marks, feedback }) => {
    const db = await createClient();
    const { data, error } = await db.rpc("save_test_marks", { p_response_id: responseId, p_marks: marks, p_feedback: feedback ?? undefined });
    if (error) throwMapped(error);
    return data as unknown as { responseId: string; teacherMarks: number; pending: number };
  },
});

export const finaliseAttempt = defineAction({
  name: "onlineTests.attempt.finalise",
  schema: AttemptIdSchema,
  module: MODULE,
  permission: "online_test.mark",
  handler: async ({ attemptId }) => {
    const db = await createClient();
    const { data, error } = await db.rpc("finalise_test_attempt", { p_attempt_id: attemptId });
    if (error) throwMapped(error);
    const r = data as unknown as { status: string; objective: number; subjective: number; total: number };
    return { status: r.status, objective: Number(r.objective), subjective: Number(r.subjective), total: Number(r.total) };
  },
});

// ── Official marks bridge ──

const EXAM_WRITE_ROLES: readonly string[] = ["owner", "principal", "exam_controller"]; // app.exam_write_roles()
const MARKS_OPEN_EXAM_STATUSES: readonly string[] = ["marks_entry", "verification"]; // app.enter_marks accepts these

interface PushResult {
  /** One entry per section written (one exam paper each). */
  papers: { sectionId: string; examPaperId: string; entered: number; unchanged: number }[];
  /** Students in the test's sections with no evaluated attempt: left for the teacher (absent or not attempted). */
  notAttempted: number;
  /** Students with an evaluated attempt but no active enrolment in a test section: not sent, for the exam office to resolve. */
  notEnrolled: { studentId: string; studentName: string }[];
}

type PushRow = { student_id: string; marks_obtained: number; is_absent: false };

export const pushToMarksEntry = defineAction({
  name: "onlineTests.marks.pushToEntry",
  schema: TestIdSchema,
  module: MODULE,
  permission: "exam.marks.enter",
  handler: async ({ id }, ctx): Promise<PushResult> => {
    const db = await createClient();
    const { data: test, error } = await db
      .from("online_tests")
      .select("id, practice, status, closes_at, subject_id, section_ids, question_papers(total_marks, exam_paper_id, exam_papers(exam_id, exams(status)))")
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!test) throw new AppError("not_found", "Test not found.");
    if (test.practice) throw new AppError("invalid_state", "A practice test never feeds official marks.");
    const paper = test.question_papers as unknown as {
      total_marks: number;
      exam_paper_id: string | null;
      exam_papers: { exam_id: string; exams: { status: string } | null } | null;
    } | null;
    const examId = paper?.exam_papers?.exam_id;
    if (!paper?.exam_paper_id || !examId) throw new AppError("invalid_state", "Link the question paper to an exam before sending marks.");
    const closed = ["closed", "evaluating", "published"].includes(test.status) || Date.parse(test.closes_at) <= Date.now();
    if (!closed || test.status === "cancelled") throw new AppError("invalid_state", "Close the test before sending marks.");
    if (!MARKS_OPEN_EXAM_STATUSES.includes(paper.exam_papers?.exams?.status ?? "")) {
      throw new AppError("invalid_state", "The exam is not open for marks entry.");
    }

    const { data: attempts, error: aErr } = await db
      .from("test_attempts")
      .select("student_id, status, total_score, students(first_name, last_name)")
      .eq("test_id", id)
      .eq("institution_id", ctx.institution.id);
    if (aErr) throwMapped(aErr);
    if (attempts.some((a) => a.status !== "evaluated")) throw new AppError("invalid_state", "Finalise every attempt before sending marks.");

    // Best evaluated attempt per student.
    const best = new Map<string, number>();
    const names = new Map<string, string>();
    for (const a of attempts) {
      best.set(a.student_id, Math.max(best.get(a.student_id) ?? 0, Number(a.total_score ?? 0)));
      const s = a.students as unknown as { first_name: string; last_name: string | null } | null;
      names.set(a.student_id, [s?.first_name, s?.last_name].filter(Boolean).join(" "));
    }

    const leader = EXAM_WRITE_ROLES.includes(ctx.membership.role);
    const [{ data: enrolments, error: eErr }, { data: papers, error: pErr }] = await Promise.all([
      db.from("enrolments").select("student_id, class_section_id").eq("institution_id", ctx.institution.id).eq("status", "active").in("class_section_id", test.section_ids),
      db.from("exam_papers").select("id, class_section_id, max_marks").eq("institution_id", ctx.institution.id).eq("exam_id", examId).eq("subject_id", test.subject_id).in("class_section_id", test.section_ids),
    ]);
    if (eErr) throwMapped(eErr);
    if (pErr) throwMapped(pErr);
    // Sections a non-leader may write (enter_marks: the section's subject teacher).
    const taughtSections = new Set<string>();
    if (!leader && ctx.membership.staffId) {
      const { data: taught, error: tErr } = await db
        .from("subject_assignments")
        .select("class_section_id")
        .eq("institution_id", ctx.institution.id)
        .eq("subject_id", test.subject_id)
        .eq("teacher_id", ctx.membership.staffId)
        .in("class_section_id", test.section_ids);
      if (tErr) throwMapped(tErr);
      for (const t of taught) taughtSections.add(t.class_section_id);
    }

    const rowsBySection = new Map<string, PushRow[]>();
    const enrolled = new Set<string>();
    let notAttempted = 0;
    for (const e of enrolments) {
      enrolled.add(e.student_id);
      const total = best.get(e.student_id);
      if (total === undefined) {
        notAttempted += 1;
        continue;
      }
      rowsBySection.set(e.class_section_id, [...(rowsBySection.get(e.class_section_id) ?? []), { student_id: e.student_id, marks_obtained: total, is_absent: false }]);
    }
    const notEnrolled = [...best.keys()].filter((s) => !enrolled.has(s)).map((studentId) => ({ studentId, studentName: names.get(studentId) ?? "" }));

    // Dry run: every section must pass enter_marks' own checks before any is
    // written, so a push never lands half-done (problems keyed by section id).
    const paperBySection = new Map(papers.map((p) => [p.class_section_id, p]));
    const problems: Record<string, string[]> = {};
    const plan: { sectionId: string; examPaperId: string; rows: PushRow[] }[] = [];
    for (const [sectionId, rows] of rowsBySection) {
      const ep = paperBySection.get(sectionId);
      if (!ep) problems[sectionId] = ["This section has no paper in the exam. Add it in exam setup first."];
      else if (Number(ep.max_marks) !== Number(paper.total_marks)) problems[sectionId] = [`The exam paper is out of ${Number(ep.max_marks)}; this test is out of ${Number(paper.total_marks)}.`];
      else if (!leader && !taughtSections.has(sectionId)) problems[sectionId] = ["You do not teach this subject in this section."];
      else plan.push({ sectionId, examPaperId: ep.id, rows: rows.map((r) => ({ ...r, marks_obtained: Math.min(Math.max(r.marks_obtained, 0), Number(ep.max_marks)) })) });
    }
    const failed = Object.keys(problems).length;
    if (failed > 0) throw new AppError("invalid_state", `${failed} section(s) are not ready; no marks were sent.`, problems);

    // enter_marks re-checks the caller (exam office or the section's teacher),
    // the exam status (marks_entry/verification) and versions marks (rule 5);
    // unchanged rows are skipped, so a repeat push changes nothing.
    const result: PushResult = { papers: [], notAttempted, notEnrolled };
    for (const { sectionId, examPaperId, rows } of plan) {
      let entered = 0;
      let unchanged = 0;
      for (let i = 0; i < rows.length; i += ENTER_MARKS_BATCH) {
        const { data, error: mErr } = await db.rpc("enter_marks", {
          p_institution_id: ctx.institution.id,
          p_paper_id: examPaperId,
          p_rows: rows.slice(i, i + ENTER_MARKS_BATCH) as unknown as Json,
        });
        if (mErr) throwMapped(mErr);
        const r = data as unknown as { entered: number; unchanged: number };
        entered += r.entered;
        unchanged += r.unchanged;
      }
      result.papers.push({ sectionId, examPaperId, entered, unchanged });
    }
    if (result.papers.length > 0) {
      // Teacher marks saved after this stamp flag the test as needing a re-push (getTest.needsRepush).
      const { error: rErr } = await db.rpc("record_online_test_push", { p_test_id: id });
      if (rErr) throwMapped(rErr);
    }
    return result;
  },
});
