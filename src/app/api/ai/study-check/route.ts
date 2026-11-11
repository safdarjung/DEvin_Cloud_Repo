import "server-only";
// Study studio (student): AI check of short answers in a practice quiz against
// each question's model answer and rubric. Practice only, labelled
// "AI-checked" in the UI; nothing here is a mark and nothing is persisted —
// the student's attempt (with these checks) is saved by study.quiz.submit.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { buildStudyCheckPrompt, STUDY_CHECK_INSTRUCTIONS } from "@/modules/ai/prompts/study";
import { StudyCheckGenerationSchema, StudyCheckRequestSchema } from "@/modules/study/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_TOKENS = 2048;

export const POST = aiTaskRoute({
  route: "study-check",
  schema: StudyCheckRequestSchema,
  maxBodyBytes: 48 * 1024,
  permission: "ai.study",
  capability: "study_studio",
  module: "ai_student",
  run: async (ctx, input) => {
    const generated = await runStructured({
      ctx,
      feature: "study_answer_check",
      agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06); redacted on the cloud path
      permission: "ai.study",
      schema: StudyCheckGenerationSchema,
      instructions: STUDY_CHECK_INSTRUCTIONS,
      prompt: buildStudyCheckPrompt(input.items),
      denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;
    const { results } = generated.data.data;
    if (results.length !== input.items.length) return fail("ai_invalid_output", "The AI check did not cover every answer. Try again.");
    return ok({ results, provider: generated.data.provider, model: generated.data.model });
  },
});
