import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockerText, dedupeGroupErrors, firstBlockedPath, isComplete, optionLabel, summarizeErrors } from "@/modules/ai/components/task-card/fields";
import { libraryLoanIssue, attendanceMark } from "@/modules/ai/components/task-card/fixtures";
import { presentOption, rosterCounts, rosterShape } from "@/modules/ai/components/task-card/renderers";
import { canonicalId, getResolution, markReplaced, markResolved, resetResolutions } from "@/modules/ai/components/task-card/store";
import { summaryLines } from "@/modules/ai/components/task-card/summary";
import type { TaskFieldView, TaskView } from "@/modules/ai/tasks/types";

const status: TaskFieldView = { path: "/records/*/status", label: "Status", kind: "enum", required: true, options: ["P", "A"], optionLabels: ["Present", "Absent"] };
const oneOfView = (): TaskView => ({
  ...libraryLoanIssue().view,
  fields: [
    { path: "/accessionNo", label: "Accession no", kind: "natural_key", required: true },
    { path: "/studentId", label: "Student", kind: "entity", entity: "student", required: false },
    { path: "/staffId", label: "Staff member", kind: "entity", entity: "staff", required: false },
  ],
  values: {}, resolved: {}, candidates: {}, requireOneOf: [["/studentId", "/staffId"]],
});

describe("option labels", () => {
  it("uses optionLabels and falls back to the code", () => {
    expect(optionLabel(status, "P")).toBe("Present");
    expect(optionLabel({ options: ["P"] }, "P")).toBe("P");
    expect(optionLabel({ options: ["half_day"] }, "half_day")).toBe("half day");
  });
  it("summary sentences and the register use labels", () => {
    const view: TaskView = { ...attendanceMark().view, values: { records: [] }, fields: [{ path: "/mode", label: "Mode", kind: "enum", required: true, options: ["P", "A"], optionLabels: ["Present", "Absent"] }] };
    expect(summaryLines(view, { mode: "A" })[0].text).toBe("Absent");
    const reg: TaskView = { ...attendanceMark().view, fields: [{ path: "/records", label: "Student", kind: "array", required: true, fields: [{ path: "/records/*/studentId", label: "Student", kind: "entity", entity: "student", required: true }, status] }] };
    const shape = rosterShape(reg)!;
    expect(presentOption(shape)).toBe("P");
    expect(rosterCounts({ records: [{ status: "P" }, { status: "A" }, { status: "P" }] }, shape)).toEqual({ P: 2, A: 1 });
  });
});

describe("requireOneOf", () => {
  it("blocks until one path in the group has a value, and names the choice", () => {
    const v = oneOfView();
    expect(isComplete(v, { accessionNo: "A1" })).toBe(false);
    expect(blockerText(v, { accessionNo: "A1" })).toBe("Choose a student or a staff member.");
    expect(firstBlockedPath(v, { accessionNo: "A1" })).toBe("/studentId");
    expect(isComplete(v, { accessionNo: "A1", staffId: "t1" })).toBe(true);
  });
  it("shows a server group error once, on the first path", () => {
    const v = oneOfView();
    const errs = { "/studentId": ["Pick a student or staff member."], "/staffId": ["Pick a student or staff member."] };
    expect(dedupeGroupErrors(v, errs)).toEqual({ "/studentId": ["Pick a student or staff member."] });
    expect(summarizeErrors(v, {}, errs)).toHaveLength(1);
  });
});

describe("proposal replacement store", () => {
  beforeEach(resetResolutions);
  it("a dependent card follows a replaced proposal id", () => {
    markReplaced("old", "new");
    markReplaced("new", "newer");
    expect(canonicalId("old")).toBe("newer");
    expect(getResolution("old")).toBeUndefined();
    markResolved("newer", { status: "approved" });
    expect(getResolution("old")?.status).toBe("approved");
  });
});

describe("ai.proposal.start calls", () => {
  it("passes undo values and the replaced proposal id", async () => {
    const { startProposal } = await import("@/modules/ai/components/task-card/api");
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { json: async () => ({ ok: true, data: {} }) };
    });
    await startProposal("demo", "library.loan.return", { loanId: "l1" });
    await startProposal("demo", "attendance.mark", { classSectionId: "s1", date: "today" }, "old-id");
    vi.unstubAllGlobals();
    expect(bodies[0]).toEqual({ institution: "demo", input: { action: "library.loan.return", values: { loanId: "l1" } } });
    expect(bodies[1]).toEqual({ institution: "demo", input: { action: "attendance.mark", values: { classSectionId: "s1", date: "today" }, replaces: "old-id" } });
  });
});
