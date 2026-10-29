import { describe, expect, it } from "vitest";
import { GenerateTermInvoicesSchema, RecordPaymentSchema } from "@/modules/finance/schemas";

// Fix round 1 (code review, HIGH): the sync `generateTermInvoices` action
// has no deadline-safe way to cover a whole school in one request, so
// `gradeId` was required for one phase — an "all grades" run went through
// `public.enqueue_term_invoices` (job-queue wrapper) instead.
// T-031 phase 2: `public.enqueue_term_invoices` (20261028000017) now
// exists, so `gradeId` is optional again — omitting it means "all grades",
// routed to that RPC instead of the synchronous per-student loop.
describe("GenerateTermInvoicesSchema", () => {
  it("accepts a payload with no gradeId (all grades, enqueued)", () => {
    const result = GenerateTermInvoicesSchema.safeParse({ termId: crypto.randomUUID() });
    expect(result.success).toBe(true);
  });

  it("accepts termId + gradeId", () => {
    const result = GenerateTermInvoicesSchema.safeParse({
      termId: crypto.randomUUID(),
      gradeId: crypto.randomUUID(),
    });
    expect(result.success).toBe(true);
  });
});

// T-032 — 06 §W9. `mode` is intentionally not an enum here; it's checked
// against the institution's settings.finance.payment_modes in the action
// (recordPayment), not statically — see actions.ts.
describe("RecordPaymentSchema", () => {
  const base = {
    invoiceId: crypto.randomUUID(),
    amount: 5000,
    mode: "cash",
    receivedAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
  };

  it("accepts a valid payment with no reference", () => {
    const result = RecordPaymentSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts an optional reference", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, reference: "UTR123" });
    expect(result.success).toBe(true);
  });

  it("rejects a zero amount", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, amount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, amount: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects an amount with more than two decimal places", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, amount: 100.001 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid idempotencyKey", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, idempotencyKey: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an invoiceId that isn't a uuid", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, invoiceId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (.strict())", () => {
    const result = RecordPaymentSchema.safeParse({ ...base, extra: "nope" });
    expect(result.success).toBe(false);
  });
});
