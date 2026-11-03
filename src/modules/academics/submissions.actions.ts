"use server";

// M09-T4 — assignment.submit / assignment.grade. Thin RPC wrappers (same
// pattern as timetable/actions.ts's publishVersion): submit_assignment and
// grade_submission (migration 0071) already raise `code:<ErrorCode>` and
// audit themselves in SQL, so no extra audit() call here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  GradeSubmissionSchema,
  SubmitAssignmentSchema,
  type GradeSubmissionInput,
  type SubmitAssignmentInput,
} from "@/modules/academics/submissions.schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const submitAssignment = defineAction({
  name: "assignment.submit",
  module: "assignments",
  schema: SubmitAssignmentSchema,
  permission: "assignment.submit",
  handler: async ({ assignmentId, text, answers }: SubmitAssignmentInput) => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("submit_assignment", {
      p_assignment_id: assignmentId,
      ...(text !== undefined ? { p_text: text } : {}),
      ...(answers !== undefined ? { p_answers: answers } : {}),
    });
    if (error) throwMapped(error);

    return {
      submissionId: data.id as string,
      attempt: data.attempt as number,
      isLate: data.is_late as boolean,
      status: data.status as "submitted" | "graded",
    };
  },
});

export const gradeSubmission = defineAction({
  name: "assignment.grade",
  module: "assignments",
  schema: GradeSubmissionSchema,
  permission: "assignment.manage",
  handler: async ({ submissionId, score, maxScore, feedback }: GradeSubmissionInput) => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("grade_submission", {
      p_submission_id: submissionId,
      p_score: score,
      p_max_score: maxScore,
      ...(feedback !== undefined ? { p_feedback: feedback } : {}),
    });
    if (error) throwMapped(error);

    return {
      submissionId: data.id as string,
      status: "graded" as const,
      score: data.score as number,
      maxScore: data.max_score as number,
    };
  },
});
