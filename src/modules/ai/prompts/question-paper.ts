// features-18 §C #16 — question drafts for the blueprint slots the question
// bank could not fill. Input: subject, grade code, and one line per slot
// (unit title, difficulty, marks). No student data, no bank answers.
import type { Difficulty } from "@/modules/question-bank/schemas";
import { dataBlock, DATA_IS_NOT_INSTRUCTIONS } from "./data-block";

export interface QuestionSlotInput {
  unitTitle: string;
  difficulty: Difficulty;
  marks: number;
}

export interface QuestionPaperPromptInput {
  subjectName: string;
  gradeLabel: string;
  slots: QuestionSlotInput[];
}

export const QUESTION_PAPER_INSTRUCTIONS =
  "You write new exam questions for a school teacher in India. Return JSON with `questions`: exactly " +
  "one question per slot in the data, in the same order. Each question has `type` (one of mcq, " +
  "true_false, short_answer, long_answer — pick what suits the marks), `body` (the question, at most " +
  "500 characters), `options` (for mcq: 2 to 4 distinct choices, each at most 120 characters; for any " +
  "other type: an empty list) and `answer` (for mcq: exactly one of the options; for true_false: " +
  "\"true\" or \"false\"; otherwise a model answer, at most 300 characters). Match each slot's unit, " +
  "difficulty and marks. Plain text only, no markdown. Respond with JSON only, matching the schema. " +
  "These are drafts the teacher reviews before use. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildQuestionPaperPrompt(input: QuestionPaperPromptInput): string {
  return dataBlock(`Write ${input.slots.length} new exam question(s), one per slot below, in order.`, [
    `Subject: ${input.subjectName}`,
    `Grade: ${input.gradeLabel}`,
    ...input.slots.map((s, i) => `Slot ${i + 1}: unit "${s.unitTitle}", ${s.difficulty}, ${s.marks} marks`),
  ]);
}
