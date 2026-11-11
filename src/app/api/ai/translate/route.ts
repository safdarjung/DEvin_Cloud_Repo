import "server-only";
// features-18 §C2 — translate: text (<= 2000 chars) + target language ->
// translation, shown as an editable draft labelled "AI translation — review
// before sending". The text is untrusted data inside a nonce-delimited block
// and the instructions say translate only. Persists nothing.
import { ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { LANGUAGE_NAMES, TranslateGenerationSchema, TranslateRequestSchema } from "@/modules/ai/task-drafts";
import { buildTranslatePrompt, TRANSLATE_INSTRUCTIONS } from "@/modules/ai/prompts/task-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Indic scripts tokenise long; 2000 source chars fit with margin (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 4096;

export const POST = aiTaskRoute({
  route: "translate",
  schema: TranslateRequestSchema,
  maxBodyBytes: 16 * 1024,
  permission: "ai.generate",
  capability: "translate",
  run: async (ctx, input) => {
    const generated = await runStructured({
      ctx,
      feature: "translate",
      schema: TranslateGenerationSchema,
      instructions: TRANSLATE_INSTRUCTIONS,
      prompt: buildTranslatePrompt({ text: input.text, languageName: LANGUAGE_NAMES[input.language] }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { provider, model, fallback } = generated.data;
    const translation = generated.data.data.parts.map((p) => p.trim()).filter(Boolean).join("\n");
    return ok({ translation, language: input.language, provider, model, fallback });
  },
});
