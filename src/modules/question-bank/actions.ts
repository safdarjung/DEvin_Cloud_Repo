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
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  QuestionArchiveSchema,
  QuestionCreateSchema,
  QuestionUpdateSchema,
  type QuestionArchiveInput,
  type QuestionCreateInput,
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

export const createQuestion = defineAction({
  name: "questionBank.create",
  module: "question_bank",
  schema: QuestionCreateSchema,
  permission: "question.manage",
  handler: async (
    { subjectId, gradeId, curriculumUnitId, type, difficulty, body, options, answer, marks }: QuestionCreateInput,
    ctx,
  ) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      subject_id: subjectId,
      grade_id: gradeId,
      curriculum_unit_id: curriculumUnitId ?? null,
      type,
      difficulty,
      body,
      options: type === "mcq" ? options : null,
      answer,
      marks,
      created_by: ctx.user.id,
    };
    const { data, error } = await supabase.from("question_bank").insert(row).select("id").single();
    if (error) {
      if (isRlsViolation(error)) throw new AppError("forbidden", "Outside your teaching scope.");
      throwMapped(error);
    }

    await audit(ctx, { action: "question_bank.create", entityType: "question_bank", entityId: data.id });

    return { id: data.id as string };
  },
});

export const updateQuestion = defineAction({
  name: "questionBank.update",
  module: "question_bank",
  schema: QuestionUpdateSchema,
  permission: "question.manage",
  handler: async (
    { id, subjectId, gradeId, curriculumUnitId, type, difficulty, body, options, answer, marks }: QuestionUpdateInput,
    ctx,
  ) => {
    const supabase = await createClient();
    const row = {
      subject_id: subjectId,
      grade_id: gradeId,
      curriculum_unit_id: curriculumUnitId ?? null,
      type,
      difficulty,
      body,
      options: type === "mcq" ? options : null,
      answer,
      marks,
    };
    const { data, error } = await supabase
      .from("question_bank")
      .update(row)
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isRlsViolation(error)) throw new AppError("forbidden", "Outside your teaching scope.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Question not found.");

    await audit(ctx, { action: "question_bank.update", entityType: "question_bank", entityId: data.id });

    return { id: data.id as string };
  },
});

export const archiveQuestion = defineAction({
  name: "questionBank.archive",
  module: "question_bank",
  schema: QuestionArchiveSchema,
  permission: "question.manage",
  handler: async ({ id, isActive }: QuestionArchiveInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_bank")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, is_active")
      .maybeSingle();
    if (error) {
      if (isRlsViolation(error)) throw new AppError("forbidden", "Outside your teaching scope.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Question not found.");

    await audit(ctx, { action: "question_bank.archive", entityType: "question_bank", entityId: data.id });

    return { id: data.id as string, isActive: data.is_active as boolean };
  },
});
