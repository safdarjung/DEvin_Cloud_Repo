// SECURITY: the card reads the tool OUTPUT only; the raw tool-call INPUT (model text) is never touched.
import { describe, expect, it } from "vitest";
import { isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { libraryLoanIssue } from "@/modules/ai/components/task-card/fixtures";
import { parseTaskProposalOutput, taskProposalFromPart } from "@/modules/ai/components/task-card/parse";

describe("task proposal parsing", () => {
  it("never reads part.input", () => {
    const part = new Proxy({ output: libraryLoanIssue() } as Record<string, unknown>, {
      get(t, k) {
        if (k === "input") throw new Error("part.input was read");
        return t[k as string];
      },
    });
    expect(taskProposalFromPart(part)?.view.action).toBe("library.loan.issue");
  });
  it("returns only output values, never an injected input value", () => {
    const out = libraryLoanIssue();
    const part = { input: { task: "expenses.record", values: { amount: "99999" } }, output: out };
    const parsed = taskProposalFromPart(part);
    expect(JSON.stringify(parsed)).not.toContain("99999");
  });
  it("rejects malformed outputs", () => {
    expect(parseTaskProposalOutput(null)).toBeNull();
    expect(parseTaskProposalOutput("Card shown")).toBeNull();
    expect(parseTaskProposalOutput({ kind: "task_proposal", proposalId: "x" })).toBeNull();
    expect(parseTaskProposalOutput({ kind: "action_draft" })).toBeNull();
  });
});

describe("ActionDraftCard integration", () => {
  it("recognises propose_task parts and hands the proposal over", () => {
    expect(isDraftToolPartType("tool-propose_task")).toBe(true);
    const parsed = parseDraftToolOutput(libraryLoanIssue());
    expect(parsed && "proposal" in parsed && parsed.proposal?.proposalId).toBe("p-library-1");
  });
  it("still parses legacy draft outputs", () => {
    expect(parseDraftToolOutput({ kind: "action_draft", action: "a.b", input: { x: 1 }, summary: "s" })).toEqual({ action: "a.b", input: { x: 1 }, summary: "s" });
  });
});
