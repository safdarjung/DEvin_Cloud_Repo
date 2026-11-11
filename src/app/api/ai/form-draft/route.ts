import "server-only";
// features-18 §C2 — form from a description: <= 500 chars -> title,
// description and fields, validated whole with the forms module's own
// FormCreateSchema (toFormDraft). Invalid output is one clean
// `ai_invalid_output`, never a partial form. Persists nothing: the manager
// edits the draft in the builder and saves it with `form.create`; publishing
// stays a separate human step.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { FormDraftGenerationSchema, FormDraftRequestSchema, toFormDraft } from "@/modules/ai/task-drafts";
import { buildFormDraftPrompt, FORM_DRAFT_INSTRUCTIONS } from "@/modules/ai/prompts/task-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Up to 30 short fields (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 4096;

export const POST = aiTaskRoute({
  route: "form-draft",
  schema: FormDraftRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "form.manage",
  capability: "form_draft",
  run: async (ctx, input) => {
    const generated = await runStructured({
      ctx,
      feature: "form_draft",
      agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06); redacted on the cloud path
      schema: FormDraftGenerationSchema,
      instructions: FORM_DRAFT_INSTRUCTIONS,
      prompt: buildFormDraftPrompt({ description: input.description }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const form = toFormDraft(generated.data.data);
    if (!form.ok) return fail("ai_invalid_output", "The AI draft did not fit the form rules. Try a clearer description.");

    const { provider, model, fallback } = generated.data;
    return ok({ ...form.draft, provider, model, fallback });
  },
});
