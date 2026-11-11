// features-18 §C #15 — /api/ai/lesson-plan. Lesson 9: every generated
// string ≤500 chars. The per-field caps also keep lessonPlanDraftToForm's
// text inside the existing lesson-plan form's 2000-char fields
// (LessonPlanUpsertSchema), which is where the teacher edits and saves it.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const LESSON_PLAN_MAX_PERIODS = 6;

export const LessonPlanDraftRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    classSectionId: uuid,
    subjectId: uuid,
    curriculumUnitId: uuid,
    periods: z.number().int().min(1).max(LESSON_PLAN_MAX_PERIODS),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export type LessonPlanDraftRequest = z.infer<typeof LessonPlanDraftRequestSchema>;

export const LessonPlanGenerationSchema = z
  .object({
    objectives: z.string().trim().min(1).max(500),
    periods: z.array(z.string().trim().min(1).max(180)).min(1).max(LESSON_PLAN_MAX_PERIODS),
    activities: z.string().trim().min(1).max(300),
    assessment: z.string().trim().min(1).max(200),
    homework: z.string().trim().min(1).max(200),
  })
  .strict();
export type LessonPlanGeneration = z.infer<typeof LessonPlanGenerationSchema>;

export interface LessonPlanDraftResponse {
  draft: LessonPlanGeneration;
  unitTitle: string;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

/** The existing form's objectives + resources fields (both ≤2000 chars at every cap above). */
export function lessonPlanDraftToForm(draft: LessonPlanGeneration): { objectives: string; resources: string } {
  return {
    objectives: draft.objectives,
    resources: [
      ...draft.periods.map((outline, i) => `Period ${i + 1}: ${outline}`),
      `Activities: ${draft.activities}`,
      `Assessment: ${draft.assessment}`,
      `Homework: ${draft.homework}`,
    ].join("\n"),
  };
}
