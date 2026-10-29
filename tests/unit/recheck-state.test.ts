import { describe, expect, it } from "vitest";
import {
  isRecheckRequestOpen,
  isRecheckTransitionAllowed,
  RECHECK_STATUSES,
  type RecheckStatus,
} from "@/modules/exams/recheck-state";

// 06 §W8's state machine, mirrored by app.guard_recheck_request_status
// (20261028000022_recheck_rpcs.sql). Exhaustive over every (from, to) pair —
// a drift between this table and the SQL trigger's transition list is a
// bug caught here, not by a guardian hitting it in prod.
const ALLOWED: ReadonlySet<string> = new Set([
  "submitted->under_review",
  "under_review->approved",
  "under_review->rejected",
  "under_review->applied",
]);

describe("isRecheckTransitionAllowed (06 §W8)", () => {
  for (const from of RECHECK_STATUSES) {
    for (const to of RECHECK_STATUSES) {
      const expected = ALLOWED.has(`${from}->${to}`);
      it(`${from} -> ${to} is ${expected ? "allowed" : "forbidden"}`, () => {
        expect(isRecheckTransitionAllowed(from, to)).toBe(expected);
      });
    }
  }

  it("has no self-transition allowed (a status never moves to itself)", () => {
    for (const status of RECHECK_STATUSES) {
      expect(isRecheckTransitionAllowed(status, status)).toBe(false);
    }
  });

  it("terminal statuses (approved/rejected/applied) allow no further transition", () => {
    const terminal: RecheckStatus[] = ["approved", "rejected", "applied"];
    for (const from of terminal) {
      for (const to of RECHECK_STATUSES) {
        expect(isRecheckTransitionAllowed(from, to)).toBe(false);
      }
    }
  });

  it("submitted can never skip straight to a decided state", () => {
    expect(isRecheckTransitionAllowed("submitted", "approved")).toBe(false);
    expect(isRecheckTransitionAllowed("submitted", "rejected")).toBe(false);
    expect(isRecheckTransitionAllowed("submitted", "applied")).toBe(false);
  });

  it("a decided request can never move backwards to under_review or submitted", () => {
    for (const from of ["approved", "rejected", "applied"] as const) {
      expect(isRecheckTransitionAllowed(from, "under_review")).toBe(false);
      expect(isRecheckTransitionAllowed(from, "submitted")).toBe(false);
    }
  });
});

describe("isRecheckRequestOpen", () => {
  it("submitted and under_review are open", () => {
    expect(isRecheckRequestOpen("submitted")).toBe(true);
    expect(isRecheckRequestOpen("under_review")).toBe(true);
  });

  it("approved/rejected/applied are not open", () => {
    expect(isRecheckRequestOpen("approved")).toBe(false);
    expect(isRecheckRequestOpen("rejected")).toBe(false);
    expect(isRecheckRequestOpen("applied")).toBe(false);
  });
});
