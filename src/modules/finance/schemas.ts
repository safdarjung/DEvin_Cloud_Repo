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
// Fix round 1 (code review, HIGH): `gradeId` was made required — the
// synchronous action path has no bulk-enqueue fallback, so an unscoped
// "all grades" run could time out a whole-school institution with no
// partial progress reported.
// T-031 phase 2: `gradeId` is optional again now that
// `public.enqueue_term_invoices` (20261028000017) exists — omitting it
// means "all grades", routed to the job queue instead of the synchronous
// per-student loop (src/modules/finance/actions.ts `generateTermInvoices`).
export const GenerateTermInvoicesSchema = z
  .object({
    termId: uuid,
    gradeId: uuid.optional(),
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

// T-032 — 06 §W9 record-payment dialog. `mode` is checked against the
// institution's own settings.finance.payment_modes in the action (not
// hardcoded here as an enum) per packet rule 1 — the five-value DB check
// constraint (app.record_payment) is the outer bound, settings narrow it
// further per institution. `amount` follows this file's existing `money`
// convention (numeric(12,2)-matching JS number) rather than a paise integer
// or decimal string, for consistency with every other money field in this
// module (FeeComponentInputSchema.amount, ConcessionInputSchema.amount) —
// recorded as a deviation from the packet's literal wording in the
// completion report. `receivedAt` coerces a datetime-local input value into
// a Date, which supabase-js serializes to an ISO string for the RPC call.
export const RecordPaymentSchema = z
  .object({
    invoiceId: uuid,
    amount: z.number().positive().multipleOf(0.01),
    mode: z.string().min(1).max(20),
    reference: z.string().trim().max(200).optional(),
    receivedAt: z.coerce.date(),
    idempotencyKey: uuid,
  })
  .strict();

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

// T-M12 — M12 finance completions (06 §W9, 07 §2.2).

export const VoidPaymentSchema = z
  .object({
    paymentId: uuid,
    kind: z.enum(["void", "refund", "cheque_bounce"]),
    reason: z.string().trim().min(5).max(500),
    idempotencyKey: uuid,
  })
  .strict();

export type VoidPaymentInput = z.infer<typeof VoidPaymentSchema>;

export const SendFeeRemindersSchema = z
  .object({
    termId: uuid,
  })
  .strict();

export type SendFeeRemindersInput = z.infer<typeof SendFeeRemindersSchema>;

// Bulk actions (dashboard redesign): selected invoices/defaulters get a
// reminder; selected students get this term's invoice. 200 caps one request
// (matches enqueue_invoice_reminders' own bound).
export const SendInvoiceRemindersSchema = z
  .object({
    invoiceIds: z.array(uuid).min(1).max(200),
  })
  .strict();

export type SendInvoiceRemindersInput = z.infer<typeof SendInvoiceRemindersSchema>;

export const BulkGenerateStudentInvoicesSchema = z
  .object({
    termId: uuid,
    studentIds: z.array(uuid).min(1).max(200),
  })
  .strict();

export type BulkGenerateStudentInvoicesInput = z.infer<typeof BulkGenerateStudentInvoicesSchema>;

export const CreatePaymentIntentSchema = z
  .object({
    invoiceId: uuid,
    amount: z.number().min(1).max(10_000_000).multipleOf(0.01),
    idempotencyKey: uuid,
  })
  .strict();

export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentSchema>;

export const CollectionReportSchema = z
  .object({
    groupBy: z.enum(["term", "grade", "mode"]),
    academicYearId: uuid.optional(),
    termId: uuid.optional(),
  })
  .strict();

export type CollectionReportInput = z.infer<typeof CollectionReportSchema>;
