// T-031 — finance module schemas (06 §W9, 07 §2.2 finance.*). `.strict()` on
// every object per CLAUDE.md rule 4. Fee heads/frequencies mirror the
// `check` constraints on `fee_components`/`concessions`
// (supabase/migrations/20261028000008_finance.sql) so a bad value fails
// fast here instead of surfacing as an opaque Postgres constraint error.
import { z } from "zod";
import { money, shortText, uuid } from "@/lib/schemas/common";

export const feeHead = z.enum([
  "tuition",
  "transport",
  "annual_charges",
  "admission",
  "exam",
  "lab_computer",
  "activity",
  "caution_deposit",
]);

export const feeFrequency = z.enum(["one_time", "annual", "term", "quarterly", "monthly"]);

export const concessionKind = z.enum(["sibling", "staff_ward", "merit", "ews_rte", "hardship", "other"]);

const FeeComponentInputSchema = z
  .object({
    head: feeHead,
    amount: money,
    frequency: feeFrequency,
    appliesToNewOnly: z.boolean().optional(),
  })
  .strict();

export const UpsertFeeStructureSchema = z
  .object({
    id: uuid.optional(),
    academicYearId: uuid,
    gradeId: uuid,
    name: shortText,
    isDefault: z.boolean().optional(),
    components: z.array(FeeComponentInputSchema).min(1),
  })
  .strict();

export type UpsertFeeStructureInput = z.infer<typeof UpsertFeeStructureSchema>;

// Concession has percent XOR amount (06 §W9 validation), mirroring the
// `check ((percent is null) <> (amount is null))` constraint.
const ConcessionInputSchema = z
  .object({
    kind: concessionKind,
    head: feeHead.optional(),
    percent: z.number().positive().max(100).optional(),
    amount: money.optional(),
    reason: shortText,
  })
  .strict()
  .refine((c) => (c.percent != null) !== (c.amount != null), {
    message: "Provide exactly one of percent or amount.",
    path: ["percent"],
  });

export const AssignFeeStructureSchema = z
  .object({
    studentId: uuid,
    feeStructureId: uuid,
    academicYearId: uuid,
    concessions: z.array(ConcessionInputSchema).default([]),
  })
  .strict();

export type AssignFeeStructureInput = z.infer<typeof AssignFeeStructureSchema>;

// Packet key format `invoices:<term_id>:<grade_id|all>` — singular gradeId,
// not spec 06 §W9's `gradeIds?: uuid[]` (deviation recorded in the
// completion report; packet is the authoritative instruction here).
// Fix round 1 (code review, HIGH): `gradeId` is now required — the
// synchronous action path has no bulk-enqueue fallback, so an unscoped
// "all grades" run can time out a whole-school institution with no partial
// progress reported. Whole-school runs are phase 2, through
// `public.enqueue_term_invoices` (not built yet).
export const GenerateTermInvoicesSchema = z
  .object({
    termId: uuid,
    gradeId: uuid,
  })
  .strict();

export type GenerateTermInvoicesInput = z.infer<typeof GenerateTermInvoicesSchema>;

export const GenerateStudentInvoiceSchema = z
  .object({
    studentId: uuid,
    termId: uuid,
  })
  .strict();

export type GenerateStudentInvoiceInput = z.infer<typeof GenerateStudentInvoiceSchema>;
