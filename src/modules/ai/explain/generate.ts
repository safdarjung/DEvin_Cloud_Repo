import "server-only";
// /anatomy, /teardown, /infographic. One gateway call each (runStructured:
// permission, quota, rate, concurrency, usage row, cloud redaction). The
// prompt is only the topic the person typed, so the owner cloud exception
// applies (agentCloud, like study-generate). A photo or PDF goes through the
// study studio's own file path: file-reading consent, fileSource (ownership
// under RLS, 10 MB, magic bytes) and runStructuredFile (Gemini, neutral file
// name). Persists nothing: the answer is a suggestion on screen (rule 6).
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured, runStructuredFile } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { hasFileReadingConsent } from "@/modules/study/generate";
import { fileSource } from "@/modules/study/help-sources";
import { anatomyInstructions, anatomyPrompt, infographicInstructions, infographicPrompt } from "./prompts";
import {
  AnatomyGenerationSchema,
  InfographicGenerationSchema,
  blockedTopic,
  clip,
  toAnatomy,
  toInfographic,
  type AnatomyRequest,
  type AnatomyResponse,
  type InfographicRequest,
  type InfographicResponse,
} from "./schemas";

// lesson 9: always cap output.
const ANATOMY_TOKENS = { simple: 1500, standard: 2500, deep: 4000 } as const;
const INFOGRAPHIC_TOKENS = 3000;

const base = (ctx: TenantContext) => ({
  ctx,
  permission: "ai.chat" as const,
  denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
});

export async function explainAnatomy(ctx: TenantContext, input: AnatomyRequest): Promise<ActionResult<AnatomyResponse>> {
  const blocked = blockedTopic(input.subject);
  if (blocked) return ok({ refused: true, reason: blocked });

  const call = {
    ...base(ctx),
    feature: "explain_anatomy",
    schema: AnatomyGenerationSchema,
    instructions: anatomyInstructions(input),
    prompt: anatomyPrompt(input.subject, input.documentId !== undefined),
    maxOutputTokens: ANATOMY_TOKENS[input.depth],
  };
  let generated;
  if (input.documentId) {
    if (!(await hasFileReadingConsent(ctx))) {
      return fail("validation_failed", "Tick the box to agree that your file is sent to the school's AI provider to be read.", { consent: ["Required the first time"] });
    }
    const source = await fileSource(await createClient(), ctx, input.documentId, ctx.membership.role === "student" ? "student" : "teacher");
    if (!source.file) return fail("not_found", "That file was not found.");
    generated = await runStructuredFile({ ...call, file: source.file });
  } else {
    generated = await runStructured({ ...call, agentCloud: true });
  }
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const anatomy = toAnatomy(data);
  if (!anatomy) return fail("ai_invalid_output", "The explanation came back incomplete. Try again, or name the thing more clearly.");
  return ok({ refused: false, mode: input.mode, depth: input.depth, language: input.language, anatomy, provider, model });
}

export async function makeInfographic(ctx: TenantContext, input: InfographicRequest): Promise<ActionResult<InfographicResponse>> {
  const generated = await runStructured({
    ...base(ctx),
    feature: "infographic",
    schema: InfographicGenerationSchema,
    instructions: infographicInstructions(input),
    prompt: infographicPrompt(input.topic, input.fromAnatomy),
    maxOutputTokens: INFOGRAPHIC_TOKENS,
    agentCloud: true,
  });
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const infographic = toInfographic(data);
  if (!infographic) return fail("ai_invalid_output", "The poster came back with too few usable panels. Try again.");
  return ok({ refused: false, infographic, provider, model });
}
