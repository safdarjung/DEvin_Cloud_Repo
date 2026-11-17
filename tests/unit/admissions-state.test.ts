import { describe, expect, it } from "vitest";
import { canDecide, canStartReview, canTransitionEnquiry, nextStatusForDecision } from "@/modules/admissions/state";

const STAGES = ["new", "contacted", "visit_scheduled", "application_sent", "converted", "closed"];

describe("canTransitionEnquiry (06 §W4)", () => {
  it("allows a forward move between configured stages", () => {
    expect(canTransitionEnquiry("new", "contacted", STAGES)).toBe(true);
  });

  it("allows a backward move between configured stages", () => {
    expect(canTransitionEnquiry("visit_scheduled", "new", STAGES)).toBe(true);
  });

  it("rejects leaving converted in any direction", () => {
    expect(canTransitionEnquiry("converted", "closed", STAGES)).toBe(false);
    expect(canTransitionEnquiry("converted", "new", STAGES)).toBe(false);
  });

  it("rejects moving directly into converted via a plain status update", () => {
    expect(canTransitionEnquiry("application_sent", "converted", STAGES)).toBe(false);
  });

  it("rejects a no-op move", () => {
    expect(canTransitionEnquiry("new", "new", STAGES)).toBe(false);
  });

  it("rejects a stage not in the configured list", () => {
    expect(canTransitionEnquiry("new", "bogus", STAGES)).toBe(false);
    expect(canTransitionEnquiry("bogus", "new", STAGES)).toBe(false);
  });
});

describe("canDecide / nextStatusForDecision (06 §W4 application diagram)", () => {
  it("offer is reachable from under_review or interaction_scheduled", () => {
    expect(canDecide("under_review", "offer")).toBe(true);
    expect(canDecide("interaction_scheduled", "offer")).toBe(true);
    expect(nextStatusForDecision("offer")).toBe("offered");
  });

  it("reject is reachable only from under_review", () => {
    expect(canDecide("under_review", "reject")).toBe(true);
    expect(canDecide("offered", "reject")).toBe(false);
    expect(nextStatusForDecision("reject")).toBe("rejected");
  });

  it("accept and withdraw are reachable only from offered", () => {
    expect(canDecide("offered", "accept")).toBe(true);
    expect(canDecide("submitted", "accept")).toBe(false);
    expect(canDecide("offered", "withdraw")).toBe(true);
    expect(canDecide("under_review", "withdraw")).toBe(false);
  });

  it("submitted cannot accept directly (AC3)", () => {
    expect(canDecide("submitted", "accept")).toBe(false);
  });
});

describe("canStartReview", () => {
  it("is offered only from submitted", () => {
    expect(canStartReview("submitted")).toBe(true);
    expect(canStartReview("under_review")).toBe(false);
    expect(canStartReview("offered")).toBe(false);
  });
});
