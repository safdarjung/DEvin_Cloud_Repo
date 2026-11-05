"use server";

// X08-T7 — survey.create / survey.close / survey.respond (X08-tasks.md
// header rulings + Task 7). Mirrors src/modules/notifications/announcements.actions.ts
// (draft -> audiences -> publish/open shape) but with its own error mapping:
// per the Task 7 ruling, raw Postgres codes from the plain table writes below
// map 42501 -> forbidden, 23503 -> not_found, 23514 -> validation_failed; SQL
// functions' own `code:<ErrorCode>` exceptions still go through mapSqlError.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  SurveyCloseSchema,
  SurveyCreateSchema,
  SurveyRespondSchema,
  type SurveyCloseInput,
  type SurveyCreateInput,
  type SurveyRespondInput,
} from "@/modules/ptm/schemas";

const SURVEY_MAX_CLOSES_AT_MS = 90 * 24 * 60 * 60 * 1000;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Task 7 error-code ruling for the plain `surveys`/`survey_audiences` table writes below. */
function throwWriteError(error: { code?: string | null; message?: string }): never {
  if (error.code === "42501") {
    throw new AppError("forbidden", "You do not have permission for that audience target.");
  }
  if (error.code === "23503") {
    throw new AppError("not_found", "Referenced grade or section was not found.");
  }
  if (error.code === "23514") {
    throw new AppError("validation_failed", "Invalid survey data.");
  }
  throwMapped(error);
}

export const createSurvey = defineAction({
  name: "survey.create",
  module: "ptm",
  schema: SurveyCreateSchema,
  permission: "survey.manage",
  handler: async (input: SurveyCreateInput, ctx) => {
    const closesAtMs = new Date(input.closesAt).getTime();
    const nowMs = Date.now();
    if (closesAtMs <= nowMs || closesAtMs > nowMs + SURVEY_MAX_CLOSES_AT_MS) {
      throw new AppError("validation_failed", "closesAt must be after now and within 90 days.", {
        closesAt: ["Must be after now and at most 90 days away."],
      });
    }

    const supabase = await createClient();

    const { data: survey, error: surveyError } = await supabase
      .from("surveys")
      .insert({
        institution_id: ctx.institution.id,
        title: input.title,
        description: input.description ?? null,
        is_anonymous: input.isAnonymous,
        questions: input.questions,
        closes_at: input.closesAt,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (surveyError) throwWriteError(surveyError);

    const audienceRows = input.audiences.map((a) => ({
      survey_id: survey.id,
      institution_id: ctx.institution.id,
      audience_type: a.type,
      role: a.type === "role" ? a.role : null,
      grade_id: a.type === "grade" ? a.gradeId : null,
      class_section_id: a.type === "section" ? a.classSectionId : null,
    }));

    const { error: audiencesError } = await supabase.from("survey_audiences").insert(audienceRows);
    if (audiencesError) {
      await supabase.from("surveys").delete().eq("id", survey.id);
      throwWriteError(audiencesError);
    }

    const { error: openError } = await supabase.from("surveys").update({ status: "open" }).eq("id", survey.id);
    if (openError) {
      await supabase.from("surveys").delete().eq("id", survey.id);
      throwWriteError(openError);
    }

    await audit(ctx, {
      action: "survey.created",
      entityType: "survey",
      entityId: survey.id,
      after: {
        questionCount: input.questions.length,
        audienceCount: audienceRows.length,
        isAnonymous: input.isAnonymous,
      },
    });

    return { id: survey.id as string };
  },
});

export const closeSurvey = defineAction({
  name: "survey.close",
  module: "ptm",
  schema: SurveyCloseSchema,
  permission: "survey.manage",
  handler: async (input: SurveyCloseInput, ctx) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("surveys")
      .update({ status: "closed" })
      .eq("id", input.surveyId)
      .select("id, questions, is_anonymous")
      .maybeSingle();
    if (error) throwWriteError(error);
    if (!data) throw new AppError("not_found", "Survey not found.");

    const { count: audienceCount } = await supabase
      .from("survey_audiences")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", data.id);

    await audit(ctx, {
      action: "survey.closed",
      entityType: "survey",
      entityId: data.id,
      after: {
        questionCount: Array.isArray(data.questions) ? data.questions.length : 0,
        audienceCount: audienceCount ?? 0,
        isAnonymous: data.is_anonymous,
      },
    });

    return { id: data.id as string };
  },
});

export const respondToSurvey = defineAction({
  name: "survey.respond",
  module: "ptm",
  schema: SurveyRespondSchema,
  permission: "survey.respond",
  handler: async (input: SurveyRespondInput) => {
    const supabase = await createClient();

    const { error } = await supabase.rpc("submit_survey_response", {
      p_survey_id: input.surveyId,
      p_answers: input.answers,
    });
    if (error) throwMapped(error);

    return { surveyId: input.surveyId };
  },
});
