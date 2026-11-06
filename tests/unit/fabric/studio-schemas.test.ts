import { describe, expect, it } from "vitest";
import {
  DecideStudioRequestSchema,
  StudioProposalSchema,
  SubmitStudioRequestSchema,
} from "@/modules/fabric/studio.schemas";

// F-UI-12 (live-fabric studio lane) — Zod schema shape for the intake
// wizard and the AI proposal (BRIEF-COMMON lesson 9: structured-output
// strings capped well under 500 chars).

describe("SubmitStudioRequestSchema", () => {
  const valid = {
    title: "Hostel leave approvals",
    problem: "Wardens manage leaves on paper.",
    desiredOutcome: "Digital approval workflow.",
    budgetRange: "under_50k",
    timeline: "1 month",
    successCriteria: "All leaves digital by month-end.",
  };

  it("accepts a minimal valid request and defaults the optional arrays", () => {
    const parsed = SubmitStudioRequestSchema.parse(valid);
    expect(parsed.userRoles).toEqual([]);
    expect(parsed.constraints).toBe("");
  });

  it("rejects an empty title", () => {
    expect(SubmitStudioRequestSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects an unknown budget range", () => {
    expect(SubmitStudioRequestSchema.safeParse({ ...valid, budgetRange: "a_lot" }).success).toBe(false);
  });

  it("rejects an unknown (injected) field — .strict()", () => {
    expect(SubmitStudioRequestSchema.safeParse({ ...valid, injected: true }).success).toBe(false);
  });
});

describe("DecideStudioRequestSchema", () => {
  it("accepts approve/reject with or without a note", () => {
    expect(DecideStudioRequestSchema.safeParse({ requestId: crypto.randomUUID(), decision: "approve" }).success).toBe(true);
    expect(
      DecideStudioRequestSchema.safeParse({ requestId: crypto.randomUUID(), decision: "reject", note: "Too costly." }).success,
    ).toBe(true);
  });

  it("rejects a decision other than approve/reject", () => {
    expect(DecideStudioRequestSchema.safeParse({ requestId: crypto.randomUUID(), decision: "maybe" }).success).toBe(false);
  });

  it("rejects a note over 500 characters", () => {
    const result = DecideStudioRequestSchema.safeParse({
      requestId: crypto.randomUUID(),
      decision: "approve",
      note: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("StudioProposalSchema (runStructured output)", () => {
  const valid = {
    resolution: "new_module",
    interpretation: "A digital leave workflow tied to roles.",
    features: ["Leave request form"],
    acceptanceCriteria: ["95% approved within 6 hours"],
    costEstimatePaise: 2_500_000,
    timelineWeeks: 4,
  };

  it("accepts the minimal shape and defaults the optional arrays", () => {
    const parsed = StudioProposalSchema.parse(valid);
    expect(parsed.clarifyingQuestions).toEqual([]);
    expect(parsed.risks).toEqual([]);
  });

  it("rejects a string field over its cap", () => {
    const result = StudioProposalSchema.safeParse({ ...valid, interpretation: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown resolution", () => {
    expect(StudioProposalSchema.safeParse({ ...valid, resolution: "rewrite_everything" }).success).toBe(false);
  });

  it("requires at least one feature and one acceptance criterion", () => {
    expect(StudioProposalSchema.safeParse({ ...valid, features: [] }).success).toBe(false);
    expect(StudioProposalSchema.safeParse({ ...valid, acceptanceCriteria: [] }).success).toBe(false);
  });
});
