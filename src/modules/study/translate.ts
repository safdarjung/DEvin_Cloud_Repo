import "server-only";
// 0140 language variants (translate route's pattern: draft only, persists
// nothing). The material is read under the caller's RLS (own, or shared with
// their section); its title and reader-visible strings go to the gateway as a
// flat list; the answer comes back item for item and is written into a copy
// of the same structure, then validated against the format's schema. The
// person keeps it with study.material.saveVariant (labelled AI translation).
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { buildVariantPrompt, variantInstructions } from "@/modules/ai/prompts/study";
import { contentSchema, type MaterialFormat } from "@/modules/study/formats";
import { getStudyMaterial } from "@/modules/study/queries";
import { LANGUAGE_NAMES, MAX_VARIANT_CHARS, MAX_VARIANT_STRINGS, applyStrings, collectStrings, type VariantLanguage } from "@/modules/study/variants";

const MAX_OUTPUT_TOKENS = 8192;

export interface VariantDraft {
  baseId: string;
  format: MaterialFormat;
  title: string;
  language: VariantLanguage;
  content: unknown;
  provider: "local" | "cloud";
  model: string;
}

export async function translateMaterial(
  ctx: TenantContext,
  input: { materialId: string; language: VariantLanguage },
  audience: "student" | "teacher",
): Promise<ActionResult<VariantDraft>> {
  const material = await getStudyMaterial(ctx, input.materialId);
  if (!material) return fail("not_found", "That material was not found.");
  if (material.language === input.language) return fail("validation_failed", `This material is already in ${LANGUAGE_NAMES[input.language]}.`);

  const strings = [material.title, ...collectStrings(material.content)];
  if (strings.length > MAX_VARIANT_STRINGS || strings.join("").length > MAX_VARIANT_CHARS) {
    return fail("validation_failed", "This material is too long to translate in one go. Shorten it first.");
  }
  const schema = z.object({ items: z.array(z.string().max(2000)).min(1).max(MAX_VARIANT_STRINGS) }).strict();
  const generated = await runStructured({
    ctx,
    feature: audience === "student" ? "study_translate" : "teacher_study_translate",
    permission: audience === "student" ? "ai.study" : "ai.generate",
    agentCloud: true, // owner cloud exception (D28 ext.): the material's own text, redacted
    schema,
    strictSchema: schema.refine((d) => d.items.length === strings.length, { message: `return exactly ${strings.length} items`, path: ["items"] }),
    instructions: variantInstructions(LANGUAGE_NAMES[input.language]),
    prompt: buildVariantPrompt(strings, LANGUAGE_NAMES[input.language]),
    denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!generated.ok) return generated;

  const [title, ...rest] = generated.data.data.items.map((s) => s.replace(/^\[\d+\]\s*/, ""));
  const content = applyStrings(material.content, rest);
  const parsed = content === null ? null : contentSchema(material.format).safeParse(content);
  if (!parsed?.success) return fail("ai_invalid_output", "The translation did not keep the material's structure. Try again.");
  return ok({
    // Variants hang off the original, never off another variant.
    baseId: material.variantOf ?? material.id,
    format: material.format,
    title: (title || material.title).slice(0, 160),
    language: input.language,
    content: parsed.data,
    provider: generated.data.provider,
    model: generated.data.model,
  });
}
