import "server-only";
// features-18 §C #15 — "Draft with AI" on /lesson-plans. The unit is
// re-read through the academics owner queries under the caller's RLS; the
// draft fills the existing form and the teacher saves it with
// upsertLessonPlan (curriculum.actions.ts). This route writes nothing but
// usage. Permission: assignment.manage — the one that action needs.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { listSectionSubjects } from "@/modules/academics/assignments.queries";
import { curriculumSectionUnits } from "@/modules/academics/curriculum.queries";
import {
  LessonPlanDraftRequestSchema,
  LessonPlanGenerationSchema,
  type LessonPlanDraftRequest,
  type LessonPlanDraftResponse,
} from "@/modules/ai/lesson-plan.schemas";
import { buildLessonPlanPrompt, LESSON_PLAN_INSTRUCTIONS } from "@/modules/ai/prompts/lesson-plan";
import { aiTaskRoute } from "@/modules/ai/task-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lesson 9: always cap output (≈1.9k chars of JSON at every field cap).
const MAX_OUTPUT_TOKENS = 2048;

export const POST = aiTaskRoute<LessonPlanDraftRequest, LessonPlanDraftResponse>({
  route: "lesson-plan",
  schema: LessonPlanDraftRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "assignment.manage",
  capability: "lesson_plan_writer",
  run: async (ctx, input) => {
    // A teacher sees only subjects they teach in this section (owner/principal:
    // all); a unit of another grade, subject or school is simply not returned.
    const subjectName = (await listSectionSubjects(ctx, input.classSectionId)).find((s) => s.id === input.subjectId)?.name;
    const unitTitle = subjectName
      ? (await curriculumSectionUnits(ctx, { classSectionId: input.classSectionId, subjectId: input.subjectId })).find(
          (u) => u.id === input.curriculumUnitId,
        )?.title
      : undefined;
    if (!subjectName || !unitTitle) return fail("not_found", "Curriculum unit not found for a subject you teach in this section.");

    const generated = await runStructured({
      ctx,
      feature: "lesson_plan_draft",
      agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06); redacted on the cloud path
      schema: LessonPlanGenerationSchema,
      instructions: LESSON_PLAN_INSTRUCTIONS,
      prompt: buildLessonPlanPrompt({ subjectName, unitTitle, periods: input.periods, notes: input.notes ?? null }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { data, provider, model, fallback } = generated.data;
    return ok({ draft: { ...data, periods: data.periods.slice(0, input.periods) }, unitTitle, provider, model, fallback });
  },
});
