// Features-18 #9 — scholarships Zod schemas (migration 0118). Money is
// integer paise; a rule or award carries a percent XOR an amount, mirroring
// the `num_nonnulls(percent, amount_paise) = 1` checks. Decisions go only
// through public.decide_concession_award (owner/principal, approver ≠
// requester). Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const AWARD_STATUSES = ["pending", "approved", "rejected"] as const;
export const AWARD_DECISIONS = ["approved", "rejected"] as const;
/** ₹10,00,000 — no single concession above this. */
export const MAX_CONCESSION_PAISE = 100_000_000;
export const AWARDS_PAGE_SIZE = 25;

export const SCHOLARSHIPS_LIMITED_NOTE = "Recorded, not auto-applied to invoices.";

const percent = z.number().positive().max(100).multipleOf(0.01);
const amountPaise = z.number().int().positive().max(MAX_CONCESSION_PAISE);

export const ConcessionRuleSaveSchema = z
  .object({
    /** Present = edit that rule; absent = create. */
    id: uuid.optional(),
    name: z.string().trim().min(1).max(80),
    criteria: z.string().trim().min(1).max(500).optional(),
    percent: percent.optional(),
    amountPaise: amountPaise.optional(),
  })
  .strict()
  .refine((r) => (r.percent != null) !== (r.amountPaise != null), {
    message: "Give a percent or an amount, not both.",
    path: ["percent"],
  });
export type ConcessionRuleSaveInput = z.infer<typeof ConcessionRuleSaveSchema>;

export const ConcessionRuleSetActiveSchema = z.object({ id: uuid, isActive: z.boolean() }).strict();
export type ConcessionRuleSetActiveInput = z.infer<typeof ConcessionRuleSetActiveSchema>;

/** The award copies the rule's value at request time; later rule edits never change it. */
export const ConcessionAwardRequestSchema = z
  .object({
    studentId: uuid,
    ruleId: uuid,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type ConcessionAwardRequestInput = z.infer<typeof ConcessionAwardRequestSchema>;

export const ConcessionAwardDecideSchema = z
  .object({
    awardId: uuid,
    decision: z.enum(AWARD_DECISIONS),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ConcessionAwardDecideInput = z.infer<typeof ConcessionAwardDecideSchema>;

export const ConcessionAwardListSchema = z
  .object({
    status: z.enum(AWARD_STATUSES).optional(),
    page: z.number().int().min(1).max(1000).default(1),
  })
  .strict();
export type ConcessionAwardListInput = z.input<typeof ConcessionAwardListSchema>;

export const ConcessionRuleListSchema = z.object({ includeInactive: z.boolean().optional() }).strict();
export type ConcessionRuleListInput = z.infer<typeof ConcessionRuleListSchema>;

export const ConcessionSummarySchema = z.object({}).strict();
