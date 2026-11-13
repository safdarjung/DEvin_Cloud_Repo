"use server";

// Practice with server-held keys (migration 0151). practice.startBank serves
// approved bank questions without keys; an AI quiz session is created by
// /api/ai/practice-quiz through the service role. practice.submitSession
// marks every answer in SQL (app.mark_test_item, the online-test marker) and
// records the practice_attempts row. The client never sends a key or a score.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  StartBankPracticeSchema,
  SubmitSessionSchema,
  type PracticeSession,
  type PracticeSubmitResult,
  type StartBankPracticeInput,
  type SubmitSessionInput,
} from "@/modules/practice/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const startBankPractice = defineAction({
  name: "practice.startBank",
  module: "practice",
  schema: StartBankPracticeSchema,
  permission: "practice.attempt",
  handler: async ({ curriculumUnitId, topicId, difficulty, count }: StartBankPracticeInput, ctx): Promise<PracticeSession> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_bank_practice", {
      p_institution_id: ctx.institution.id,
      p_curriculum_unit_id: curriculumUnitId,
      p_topic_id: topicId,
      p_difficulty: difficulty,
      p_count: count,
    });
    if (error) throwMapped(error);
    return data as unknown as PracticeSession;
  },
});

export const submitPracticeSession = defineAction({
  name: "practice.submitSession",
  module: "practice",
  schema: SubmitSessionSchema,
  permission: "practice.attempt",
  handler: async ({ sessionId, answers }: SubmitSessionInput): Promise<PracticeSubmitResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_practice_session", { p_session_id: sessionId, p_answers: answers });
    if (error) throwMapped(error);
    return data as unknown as PracticeSubmitResult;
  },
});
