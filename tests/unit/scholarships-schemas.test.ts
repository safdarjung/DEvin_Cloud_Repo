import { describe, expect, it } from "vitest";
import {
  ConcessionAwardDecideSchema,
  ConcessionAwardListSchema,
  ConcessionAwardRequestSchema,
  ConcessionRuleSaveSchema,
  ConcessionRuleSetActiveSchema,
  MAX_CONCESSION_PAISE,
} from "@/modules/scholarships/schemas";

// Features-18 #9 — scholarships schemas mirror the 0118 checks (percent XOR
// amount_paise, reason 5..500, decision approved|rejected).
const ID = "00000000-0000-4000-8000-000000000001";

describe("scholarships schemas", () => {
  it("a rule takes exactly one of percent or amountPaise", () => {
    expect(ConcessionRuleSaveSchema.safeParse({ name: "Sibling", percent: 10 }).success).toBe(true);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "Merit", amountPaise: 500_000 }).success).toBe(true);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "Both", percent: 10, amountPaise: 500_000 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "Neither" }).success).toBe(false);
  });

  it("rule values stay in range: percent 0..100 with two decimals, amount whole paise up to the cap", () => {
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", percent: 0 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", percent: 100 }).success).toBe(true);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", percent: 100.01 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", percent: 12.345 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", amountPaise: 1.5 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", amountPaise: MAX_CONCESSION_PAISE + 1 }).success).toBe(false);
  });

  it("rule name is trimmed, required and at most 80 characters; unknown keys are refused", () => {
    expect(ConcessionRuleSaveSchema.parse({ name: "  EWS  ", percent: 25 }).name).toBe("EWS");
    expect(ConcessionRuleSaveSchema.safeParse({ name: "   ", percent: 25 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x".repeat(81), percent: 25 }).success).toBe(false);
    expect(ConcessionRuleSaveSchema.safeParse({ name: "x", percent: 25, isActive: false }).success).toBe(false);
    expect(ConcessionRuleSetActiveSchema.safeParse({ id: ID, isActive: false }).success).toBe(true);
  });

  it("an award request needs a student, a rule and a 5..500 character reason, and never a value", () => {
    expect(ConcessionAwardRequestSchema.safeParse({ studentId: ID, ruleId: ID, reason: "Sibling in grade IV" }).success).toBe(true);
    expect(ConcessionAwardRequestSchema.safeParse({ studentId: ID, ruleId: ID, reason: "  ab " }).success).toBe(false);
    expect(ConcessionAwardRequestSchema.safeParse({ studentId: ID, ruleId: ID, reason: "x".repeat(501) }).success).toBe(false);
    expect(ConcessionAwardRequestSchema.safeParse({ studentId: ID, ruleId: ID, reason: "Hardship case", percent: 100 }).success).toBe(false);
  });

  it("a decision is approved or rejected only, with an optional note up to 500 characters", () => {
    expect(ConcessionAwardDecideSchema.safeParse({ awardId: ID, decision: "approved" }).success).toBe(true);
    expect(ConcessionAwardDecideSchema.safeParse({ awardId: ID, decision: "rejected", note: "Income proof missing" }).success).toBe(true);
    expect(ConcessionAwardDecideSchema.safeParse({ awardId: ID, decision: "pending" }).success).toBe(false);
    expect(ConcessionAwardDecideSchema.safeParse({ awardId: ID, decision: "approved", note: "x".repeat(501) }).success).toBe(false);
  });

  it("the award list defaults to page 1 and filters by a known status", () => {
    expect(ConcessionAwardListSchema.parse({})).toEqual({ page: 1 });
    expect(ConcessionAwardListSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(ConcessionAwardListSchema.safeParse({ status: "void" }).success).toBe(false);
  });
});
