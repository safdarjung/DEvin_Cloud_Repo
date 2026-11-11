// Safety (features-18 #21) — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const SAFETY_KINDS = ["emergency", "drill", "closure"] as const;
export const SAFETY_AUDIENCES = ["all", "staff", "sections"] as const;
export type SafetyKind = (typeof SAFETY_KINDS)[number];
export type SafetyAudience = (typeof SAFETY_AUDIENCES)[number];

const audienceShape = {
  audience: z.enum(SAFETY_AUDIENCES),
  /** Required (1-200, distinct) for audience `sections`; refused for the others — same rule as create_safety_alert. */
  sectionIds: z.array(uuid).max(200).optional(),
};

function sectionsProblem(v: { audience: SafetyAudience; sectionIds?: string[] }): string | null {
  const n = v.sectionIds?.length ?? 0;
  if (v.audience === "sections" && n === 0) return "Pick at least one section.";
  if (v.audience !== "sections" && n > 0) return "Sections apply only when the audience is sections.";
  if (new Set(v.sectionIds ?? []).size !== n) return "Each section can be picked once.";
  return null;
}

export const AlertAudienceSchema = z
  .object(audienceShape)
  .strict()
  .superRefine((v, ctx) => {
    const problem = sectionsProblem(v);
    if (problem) ctx.addIssue({ code: "custom", path: ["sectionIds"], message: problem });
  });
export type AlertAudienceInput = z.infer<typeof AlertAudienceSchema>;

export const AlertSendSchema = z
  .object({
    kind: z.enum(SAFETY_KINDS),
    title: z.string().trim().min(1).max(200),
    /** Plain text, rendered as text everywhere (never HTML). */
    message: z.string().trim().min(1).max(1000),
    ...audienceShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    const problem = sectionsProblem(v);
    if (problem) ctx.addIssue({ code: "custom", path: ["sectionIds"], message: problem });
  });
export type AlertSendInput = z.infer<typeof AlertSendSchema>;

export const AlertIdSchema = z.object({ alertId: uuid }).strict();
export type AlertIdInput = z.infer<typeof AlertIdSchema>;

export const HeadcountSchema = z
  .object({
    alertId: uuid,
    classSectionId: uuid,
    presentCount: z.number().int().min(0).max(1000),
    missingCount: z.number().int().min(0).max(1000),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type HeadcountInput = z.infer<typeof HeadcountSchema>;

export const AlertListSchema = z.object({ page: z.number().int().min(1).max(1000).optional() }).strict();
export type AlertListInput = z.infer<typeof AlertListSchema>;
