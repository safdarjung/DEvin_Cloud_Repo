import "server-only";
// AI roles P4 — academics.gradeSuggestions. Read-only: compares each
// submission's `content.answers[]` (0071 `submit_assignment`, index-aligned
// to the assignment's quiz questions) against `assignment_answer_keys.
// answers.questions[].answer` (0023, same index alignment — see
// assignments.schemas.ts's splitQuizContent/mergeQuizContent). Never calls
// `assignment.grade` — a human saves a suggestion via the existing action.
// RLS (assignment_answer_keys_select / assignment_submissions_select) scopes
// both reads to the caller's own taught subject/section, same as
// gradeSubmission's own `assignment.manage` permission.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface GradeSuggestion {
  submissionId: string;
  studentId: string;
  correctCount: number;
  totalQuestions: number;
  suggestedScore: number;
  maxScore: number;
}

export interface GradeSuggestionsResult {
  suggestions: GradeSuggestion[];
  /** Why `suggestions` is empty — null when at least one was produced. */
  reason: string | null;
}

interface AnswerKeyQuestion {
  answer: string;
}

export async function gradeSuggestions(ctx: TenantContext, assignmentId: string): Promise<GradeSuggestionsResult> {
  const supabase = await createClient();

  const { data: answerKey, error: keyError } = await supabase
    .from("assignment_answer_keys")
    .select("answers")
    .eq("institution_id", ctx.institution.id)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (keyError) throw keyError;
  if (!answerKey) {
    return { suggestions: [], reason: "No answer key for this assignment — not machine-comparable." };
  }

  const keyQuestions = ((answerKey.answers as { questions?: AnswerKeyQuestion[] } | null)?.questions ?? []).filter(
    (q): q is AnswerKeyQuestion => typeof q?.answer === "string",
  );
  if (keyQuestions.length === 0) {
    return { suggestions: [], reason: "Answer key has no objective questions." };
  }

  const { data: submissions, error: subError } = await supabase
    .from("assignment_submissions")
    .select("id, student_id, content")
    .eq("institution_id", ctx.institution.id)
    .eq("assignment_id", assignmentId)
    .in("status", ["submitted", "graded"]);
  if (subError) throw subError;

  const suggestions: GradeSuggestion[] = [];
  for (const row of submissions ?? []) {
    const answers = (row.content as { answers?: unknown } | null)?.answers;
    if (!Array.isArray(answers) || answers.length !== keyQuestions.length) continue;
    let correctCount = 0;
    for (let i = 0; i < keyQuestions.length; i += 1) {
      if (answers[i] === keyQuestions[i].answer) correctCount += 1;
    }
    suggestions.push({
      submissionId: row.id,
      studentId: row.student_id,
      correctCount,
      totalQuestions: keyQuestions.length,
      suggestedScore: correctCount,
      maxScore: keyQuestions.length,
    });
  }

  return {
    suggestions,
    reason: suggestions.length === 0 ? "No objective (machine-comparable) submissions found." : null,
  };
}
