import { describe, expect, it } from "vitest";
import { GenerateTermInvoicesSchema } from "@/modules/finance/schemas";

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
