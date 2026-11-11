import { describe, expect, it } from "vitest";
import { canApproveAll } from "@/modules/ai/components/task-card/fields";
import { attendanceMark, dependentStack, expensesRecord, leaveApprove, libraryLoanIssue } from "@/modules/ai/components/task-card/fixtures";

describe("canApproveAll", () => {
  it("is true only when every card is low risk and reversible", () => {
    expect(canApproveAll(dependentStack().map((p) => p.view))).toBe(true);
  });
  it("is false with any user_confirmed, human_approved or rule-6 card", () => {
    expect(canApproveAll([attendanceMark().view, libraryLoanIssue().view])).toBe(false);
    expect(canApproveAll([attendanceMark().view, leaveApprove().view])).toBe(false);
    expect(canApproveAll([attendanceMark().view, expensesRecord().view])).toBe(false);
  });
  it("is false for a single card", () => {
    expect(canApproveAll([attendanceMark().view])).toBe(false);
  });
});
