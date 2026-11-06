"use server";

// practice.submitAttempt — records a finished practice quiz through the
// definer RPC of migration 0103, which verifies the caller is that student,
// that the unit belongs to the student's subjects, and recomputes the score
// from the answer keys. The client never sends a score.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { SubmitAttemptSchema, type SubmitAttemptInput } from "@/modules/practice/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const submitPracticeAttempt = defineAction({
  name: "practice.submitAttempt",
  module: "practice",
  schema: SubmitAttemptSchema,
  permission: "practice.attempt",
  handler: async ({ studentId, curriculumUnitId, difficulty, questions, answers }: SubmitAttemptInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_practice_attempt", {
      p_institution_id: ctx.institution.id,
      p_student_id: studentId,
      p_curriculum_unit_id: curriculumUnitId,
      p_difficulty: difficulty,
      p_questions: questions,
      p_answers: answers,
    });
    if (error) throwMapped(error);
    return { attemptId: data.id, score: data.score, maxScore: data.max_score };
  },
});
