import { describe, expect, test } from "vitest";
import { LeadInputSchema } from "@/lib/marketing/lead-schema";

const base = { kind: "demo", name: "Asha", email: "asha@school.in" };

describe("LeadInputSchema", () => {
  test("accepts minimal demo request and defaults honeypot to empty", () => {
    const r = LeadInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.website).toBe("");
  });

  test("rejects invalid email", () => {
    expect(LeadInputSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });

  test("rejects unknown kind", () => {
    expect(LeadInputSchema.safeParse({ ...base, kind: "sale" }).success).toBe(false);
  });

  test("rejects message over 2000 chars", () => {
    expect(LeadInputSchema.safeParse({ ...base, message: "x".repeat(2001) }).success).toBe(false);
  });
});
