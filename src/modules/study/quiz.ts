// Studio quiz marking. MCQ and true/false are marked here (and again on the
// server before an attempt is stored); short answers are checked by the AI
// route and shown as "AI-checked practice". Nothing here is a mark.
import type { QuizQuestion } from "@/modules/study/formats";

export type QuizAnswer = number | boolean | string | null;
export type Verdict = "correct" | "incorrect" | "unanswered" | "ai_check";

export const SHORT_ANSWER_MAX = 1000;
/** Points per AI-checked short answer: 0 missing, 1 partly right, 2 right. */
export const AI_POINTS_PER_SHORT = 2;

/** Each answer is null or the right kind for its question (option index, true/false, text). */
export function answersFitQuestions(questions: readonly QuizQuestion[], answers: readonly QuizAnswer[]): boolean {
  if (answers.length !== questions.length) return false;
  return questions.every((q, i) => {
    const a = answers[i];
    if (a === null) return true;
    if (q.type === "mcq") return typeof a === "number" && Number.isInteger(a) && a >= 0 && a <= 3;
    if (q.type === "true_false") return typeof a === "boolean";
    return typeof a === "string" && a.length <= SHORT_ANSWER_MAX;
  });
}

export function autoMark(
  questions: readonly QuizQuestion[],
  answers: readonly QuizAnswer[],
): { verdicts: Verdict[]; autoScore: number; autoMax: number; shortCount: number } {
  let autoScore = 0;
  let autoMax = 0;
  let shortCount = 0;
  const verdicts = questions.map((q, i): Verdict => {
    const a = answers[i] ?? null;
    if (q.type === "short") {
      shortCount += 1;
      return typeof a === "string" && a.trim() ? "ai_check" : "unanswered";
    }
    autoMax += 1;
    if (a === null) return "unanswered";
    const right = q.type === "mcq" ? a === q.answerIndex : a === q.answer;
    if (right) autoScore += 1;
    return right ? "correct" : "incorrect";
  });
  return { verdicts, autoScore, autoMax, shortCount };
}
