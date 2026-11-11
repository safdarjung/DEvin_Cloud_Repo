// features-18 §C #15 — lesson plan draft prompt. Input: subject name, unit
// title, period count and the teacher's optional notes (untrusted, inside
// the data block). No student data at all.
import { dataBlock, DATA_IS_NOT_INSTRUCTIONS } from "./data-block";

export interface LessonPlanPromptInput {
  subjectName: string;
  unitTitle: string;
  periods: number;
  notes: string | null;
}

export const LESSON_PLAN_INSTRUCTIONS =
  "You draft a lesson plan for a school teacher in India, for the curriculum unit in the data. " +
  "Return JSON with: `objectives` (what students will be able to do, at most 500 characters), " +
  "`periods` (one short outline per class period — exactly as many as the number of periods in " +
  "the data, each at most 180 characters), `activities` (at most 300 characters), `assessment` " +
  "(one quick check of understanding, at most 200 characters) and `homework` (at most 200 " +
  "characters). Plain text only — no markdown, no commentary. Respond with JSON only, matching " +
  "the schema. The teacher will review and edit this draft before saving it. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildLessonPlanPrompt(input: LessonPlanPromptInput): string {
  return dataBlock(`Draft a lesson plan for ${input.periods} class period(s).`, [
    `Subject: ${input.subjectName}`,
    `Curriculum unit: ${input.unitTitle}`,
    `Number of periods: ${input.periods}`,
    ...(input.notes ? [`Teacher's notes: ${input.notes}`] : []),
  ]);
}
