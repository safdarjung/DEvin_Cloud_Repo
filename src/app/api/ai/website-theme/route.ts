import "server-only";
// AI look updater — a website theme from a brief ("warm, traditional, navy
// and gold"). Output is the website module's strict WebsiteThemeSchema (hex
// colours and allow-listed keys only), re-checked here before it leaves the
// route. Persists nothing (rule 6): the theme form is filled and the user
// saves with website.theme.save.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { WebsiteThemeRequestSchema } from "@/modules/ai/website-drafts";
import { buildWebsiteThemePrompt, WEBSITE_THEME_INSTRUCTIONS } from "@/modules/ai/prompts/website-drafts";
import { WebsiteThemeSchema } from "@/modules/website/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_TOKENS = 1024;

export const POST = aiTaskRoute({
  route: "website-theme",
  schema: WebsiteThemeRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "website.publish",
  capability: "website_theme_draft",
  run: async (ctx, input) => {
    const generated = await runStructured({
      ctx,
      feature: "website_theme_draft",
      agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06); redacted on the cloud path
      schema: WebsiteThemeSchema,
      instructions: WEBSITE_THEME_INSTRUCTIONS,
      prompt: buildWebsiteThemePrompt({ schoolName: ctx.institution.name, brief: input.brief }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const theme = WebsiteThemeSchema.safeParse(generated.data.data);
    if (!theme.success) return fail("ai_invalid_output", "The AI suggestion was not a valid look. Try again.");

    const { provider, model, fallback } = generated.data;
    return ok({ theme: theme.data, provider, model, fallback });
  },
});
