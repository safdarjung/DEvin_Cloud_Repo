"use server";

// M11-T4 — questionBank.create / questionBank.update / questionBank.archive
// (M11-tasks.md rulings; migration 0073). Style mirrors
// academics/setup.actions.ts's upsertGrade (update by id, 0 rows -> not_found)
// and timetable/actions.ts's throwMapped/isRlsViolation helpers. RLS
// (0073) already scopes insert/update to owner/principal/exam_controller or
// a teacher's taught (grade, subject) pairs — a teacher writing outside
// that scope hits the insert policy (42501), mapped below to `forbidden`
// per M11-tasks.md's ErrorCode mapping ruling. A teacher's update attempt on
// another teacher's question matches 0 rows (not a policy error — see
// tests/db/question-bank-rls.test.ts), mapped to `not_found`.
//
// 0146 (Phase 1, 15-learning-exam-system-plan.md): review workflow. Manual
// questions save as approved; ai/import save as drafts. submit -> in_review;
// approve/reject need question.approve here AND a reviewer role in
// app.question_bank_guard (so a direct PostgREST write obeys the same rule).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { findNearDuplicates } from "@/modules/question-bank/queries";
import {
  QuestionApproveSchema,
  QuestionArchiveSchema,
  QuestionCreateSchema,
  QuestionIdSchema,
  QuestionRejectSchema,
  QuestionUpdateSchema,
  questionShapeColumns,
  type QuestionApproveInput,
  type QuestionArchiveInput,
  type QuestionCreateInput,
  type QuestionIdInput,
  type QuestionRejectInput,
  type QuestionShape,
  type QuestionStatus,
  type QuestionUpdateInput,
} from "@/modules/question-bank/schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

function throwWriteError(error: unknown): never {
  if (isRlsViolation(error)) throw new AppError("forbidden", "Outside your teaching scope.");
  throwMapped(error);
}

/** Columns shared by create and update. `undefined` keys are dropped by supabase-js, so update leaves them as they are. */
function questionColumns(q: QuestionShape) {
  const shape = questionShapeColumns(q);
  return {
    subject_id: q.subjectId,
    grade_id: q.gradeId,
    curriculum_unit_id: q.curriculumUnitId ?? null,
    curriculum_topic_id: q.curriculumTopicId,
    type: q.type,
    difficulty: q.difficulty,
    body: q.body,
    marks: q.marks,
    options: shape.options as Json,
    answer_key: shape.answer_key as Json,
    answer: shape.answer,
    explanation: q.explanation,
    marking_scheme: q.markingScheme,
    learning_outcome: q.learningOutcome,
    source_subject_textbook_id: q.sourceSubjectTextbookId,
    source_chapter_no: q.sourceChapterNo,
    source_page: q.sourcePage,
    stem_question_id: q.stemQuestionId,
  };
}

export const createQuestion = defineAction({
  name: "questionBank.create",
  module: "question_bank",
  schema: QuestionCreateSchema,
  permission: "question.manage",
  handler: async (input: QuestionCreateInput, ctx) => {
    const supabase = await createClient();
    // The action sets origin: "ai" only from the AI save paths (Orb proposals, paper builder); import only via
    // questionBank.import. A client-claimed "manual" is trusted by owner rule (manual questions skip review).
    const origin = input.origin === "ai" ? "ai" : "manual";
    // Owner brief: only AI and imported questions need review.
    const status: QuestionStatus = origin === "manual" ? "approved" : "draft";
    const { data, error } = await supabase
      .from("question_bank")
      .insert({
        ...questionColumns(input),
        institution_id: ctx.institution.id,
        created_by: ctx.user.id,
        origin,
        ai_model: origin === "ai" ? (input.aiModel ?? null) : null,
        status,
      })
      .select("id")
      .single();
    if (error) throwWriteError(error);

    await audit(ctx, { action: "question_bank.create", entityType: "question_bank", entityId: data.id, after: { origin, status } });

    const warnings = await findNearDuplicates(ctx, input.gradeId, input.subjectId, [input.body], data.id);
    return { id: data.id as string, status, warnings };
  },
});

export const updateQuestion = defineAction({
  name: "questionBank.update",
  module: "question_bank",
  schema: QuestionUpdateSchema,
  permission: "question.manage",
  handler: async (input: QuestionUpdateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_bank")
      .update(questionColumns(input))
      .eq("id", input.id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwWriteError(error);
    if (!data) throw new AppError("not_found", "Question not found.");

    await audit(ctx, { action: "question_bank.update", entityType: "question_bank", entityId: data.id });

    const warnings = await findNearDuplicates(ctx, input.gradeId, input.subjectId, [input.body], data.id);
    return { id: data.id as string, warnings };
  },
});

async function loadQuestion(ctx: TenantContext, id: string): Promise<{ status: QuestionStatus; origin: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_bank")
    .select("status, origin")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Question not found.");
  return { status: data.status as QuestionStatus, origin: data.origin };
}

/** Moves a question from one of `from` to `to` (status re-checked in the UPDATE filter). */
async function transition(
  ctx: TenantContext,
  id: string,
  from: readonly QuestionStatus[],
  to: QuestionStatus,
  extra: { review_note?: string | null } = {},
): Promise<{ id: string; status: QuestionStatus }> {
  const current = await loadQuestion(ctx, id);
  if (!from.includes(current.status)) {
    throw new AppError("invalid_state", `A ${current.status.replace("_", " ")} question cannot move to ${to.replace("_", " ")}.`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_bank")
    .update({ status: to, ...extra })
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .in("status", from)
    .select("id")
    .maybeSingle();
  if (error) throwWriteError(error);
  // 0 rows: not this caller's question (RLS), or its status changed meanwhile.
  if (!data) throw new AppError("not_found", "Question not found, or you cannot change it.");
  await audit(ctx, { action: `question_bank.${to}`, entityType: "question_bank", entityId: id, before: { status: current.status }, after: { status: to } });
  return { id, status: to };
}

export const archiveQuestion = defineAction({
  name: "questionBank.archive",
  module: "question_bank",
  schema: QuestionArchiveSchema,
  permission: "question.manage",
  handler: async ({ id, isActive }: QuestionArchiveInput, ctx) => {
    const { origin, status } = await loadQuestion(ctx, id);
    // Restoring an ai/import question skips review only for a reviewer.
    const restoreTo: QuestionStatus = origin === "manual" || hasPermission(ctx, "question.approve") ? "approved" : "draft";
    const to: QuestionStatus = isActive ? restoreTo : "archived";
    if (to === status) return { id, isActive: to === "approved" };
    const done = await transition(ctx, id, isActive ? ["archived"] : ["draft", "in_review", "approved", "rejected"], to);
    return { id: done.id, isActive: done.status === "approved" };
  },
});

export const submitForReview = defineAction({
  name: "questionBank.submitForReview",
  module: "question_bank",
  schema: QuestionIdSchema,
  permission: "question.manage",
  handler: ({ id }: QuestionIdInput, ctx) => transition(ctx, id, ["draft", "rejected"], "in_review"),
});

export const approveQuestion = defineAction({
  name: "questionBank.approve",
  module: "question_bank",
  schema: QuestionApproveSchema,
  permission: "question.approve",
  handler: ({ id, note }: QuestionApproveInput, ctx) =>
    transition(ctx, id, ["draft", "in_review"], "approved", note === undefined ? {} : { review_note: note }),
});

export const rejectQuestion = defineAction({
  name: "questionBank.reject",
  module: "question_bank",
  schema: QuestionRejectSchema,
  permission: "question.approve",
  handler: ({ id, note }: QuestionRejectInput, ctx) => transition(ctx, id, ["draft", "in_review"], "rejected", { review_note: note }),
});

export const duplicateQuestion = defineAction({
  name: "questionBank.duplicate",
  module: "question_bank",
  schema: QuestionIdSchema,
  permission: "question.manage",
  handler: async ({ id }: QuestionIdInput, ctx) => {
    const supabase = await createClient();
    const { data: src, error: readError } = await supabase
      .from("question_bank")
      .select(
        "subject_id, grade_id, curriculum_unit_id, curriculum_topic_id, type, difficulty, body, options, answer, answer_key, marks, origin, ai_model, explanation, marking_scheme, learning_outcome, source_subject_textbook_id, source_chapter_no, source_page, stem_question_id, version",
      )
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!src) throw new AppError("not_found", "Question not found.");

    const { data, error } = await supabase
      .from("question_bank")
      .insert({
        ...src,
        institution_id: ctx.institution.id,
        created_by: ctx.user.id,
        status: "draft",
        version: src.version + 1,
        parent_question_id: id,
      })
      .select("id")
      .single();
    if (error) throwWriteError(error);

    await audit(ctx, { action: "question_bank.duplicate", entityType: "question_bank", entityId: data.id, after: { parentQuestionId: id } });
    return { id: data.id as string, status: "draft" as const, version: src.version + 1 };
  },
});

