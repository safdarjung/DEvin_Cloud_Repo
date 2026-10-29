import { describe, expect, it } from "vitest";
import { GenerateTermInvoicesSchema, RecordPaymentSchema } from "@/modules/finance/schemas";

// Fix round 1 (code review, HIGH): the sync `generateTermInvoices` action
// has no deadline-safe way to cover a whole school in one request, so
// `gradeId` is required — an "all grades" run is phase 2, through a future
// `public.enqueue_term_invoices` job-queue wrapper, not this action.
describe("GenerateTermInvoicesSchema", () => {
  it("rejects a payload with no gradeId", () => {
    const result = GenerateTermInvoicesSchema.safeParse({ termId: crypto.randomUUID() });
    expect(result.success).toBe(false);
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
