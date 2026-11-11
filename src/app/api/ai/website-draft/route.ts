import "server-only";
// AI website builder — a page draft from a brief (and, for "refine", the
// editor's current blocks), validated whole against the website module's own
// BlocksSchema (toWebsiteBlocksDraft). Invalid output is one clean
// `ai_invalid_output`, never a partial page. Persists nothing (rule 6): the
// editor loads the draft into its local state; saving stays the existing
// "Save as new version" (website.page.save_version) then publish flow.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { toWebsiteBlocksDraft, WebsiteDraftGenerationSchema, WebsiteDraftRequestSchema } from "@/modules/ai/website-drafts";
import { buildWebsiteDraftPrompt, WEBSITE_DRAFT_INSTRUCTIONS } from "@/modules/ai/prompts/website-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Up to 12 blocks of short copy (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 6144;

export const POST = aiTaskRoute({
  route: "website-draft",
  schema: WebsiteDraftRequestSchema,
  // A refine request carries the page's current blocks.
  maxBodyBytes: 48 * 1024,
  permission: "website.edit",
  capability: "website_page_draft",
  run: async (ctx, input) => {
    const generated = await runStructured({
      ctx,
      feature: "website_page_draft",
      schema: WebsiteDraftGenerationSchema,
      instructions: WEBSITE_DRAFT_INSTRUCTIONS,
      prompt: buildWebsiteDraftPrompt({
        schoolName: ctx.institution.name,
        kind: input.kind,
        tone: input.tone,
        brief: input.brief,
        currentBlocks: input.currentBlocks,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const draft = toWebsiteBlocksDraft(generated.data.data, input.currentBlocks);
    if (!draft.ok) return fail("ai_invalid_output", "The AI draft did not fit the page rules. Try a clearer brief.");

    const { provider, model, fallback } = generated.data;
    return ok({ blocks: draft.blocks, provider, model, fallback });
  },
});
