import { describe, expect, it } from "vitest";
import { blockerText, initialEditing, initialValues, isComplete, missingRequired } from "@/modules/ai/components/task-card/fields";
import { attendanceMark, expensesRecord, leaveApprove, libraryLoanIssue } from "@/modules/ai/components/task-card/fixtures";
import { summaryLines } from "@/modules/ai/components/task-card/summary";
import type { TaskFieldView, TaskView } from "@/modules/ai/tasks/types";

const withFields = (fields: TaskFieldView[], values: Record<string, unknown> = {}): TaskView => ({ ...libraryLoanIssue().view, fields, values, resolved: {}, candidates: {} });

describe("isComplete", () => {
  it("a fully prefilled card is complete", () => {
    const v = libraryLoanIssue().view;
    expect(isComplete(v, initialValues(v))).toBe(true);
    expect(isComplete(leaveApprove().view, initialValues(leaveApprove().view))).toBe(true);
  });
  it("an empty required scalar and an empty required entity make it incomplete", () => {
    const view = withFields([
      { path: "/accessionNo", label: "Accession number", kind: "natural_key", required: true },
      { path: "/studentId", label: "Student", kind: "entity", entity: "student", required: true },
      { path: "/dueOn", label: "Due on", kind: "date", required: false },
    ]);
    expect(missingRequired(view, {}).map((m) => m.path)).toEqual(["/accessionNo", "/studentId"]);
    expect(isComplete(view, { accessionNo: "A1" })).toBe(false);
    expect(isComplete(view, { accessionNo: "A1", studentId: "s1" })).toBe(true);
  });
  it("a required repeater needs at least one row, and rows need their required fields", () => {
    const view = withFields([
      { path: "/rows", label: "Row", kind: "array", required: true, fields: [{ path: "/rows/*/n", label: "Name", kind: "text", required: true }] },
    ]);
    expect(isComplete(view, {})).toBe(false);
    expect(isComplete(view, { rows: [] })).toBe(false);
    expect(isComplete(view, { rows: [{}] })).toBe(false);
    expect(isComplete(view, { rows: [{ n: "x" }] })).toBe(true);
  });
  it("a human-only field must be typed before the card is complete, and a bad amount blocks", () => {
    const view = expensesRecord().view;
    const v = initialValues(view);
    expect(isComplete(view, v)).toBe(false);
    expect(isComplete(view, { ...v, amount: "1.234" })).toBe(false);
    expect(isComplete(view, { ...v, amount: "250" })).toBe(true);
  });
  it("names what is missing", () => {
    const view = withFields([
      { path: "/studentId", label: "Student", kind: "entity", entity: "student", required: true },
      { path: "/copyId", label: "Book copy", kind: "entity", entity: "library.copy", required: true },
    ]);
    expect(blockerText(view, {})).toBe("Choose student and book copy.");
  });
});

describe("initial view state", () => {
  it("opens the form when a required value is missing, the summary when complete", () => {
    const empty = withFields([{ path: "/studentId", label: "Student", kind: "entity", entity: "student", required: true }]);
    expect(initialEditing(empty, initialValues(empty))).toBe(true);
    const full = libraryLoanIssue().view;
    expect(initialEditing(full, initialValues(full))).toBe(false);
    expect(initialEditing(expensesRecord().view, initialValues(expensesRecord().view))).toBe(true);
    expect(initialEditing(attendanceMark().view, initialValues(attendanceMark().view))).toBe(false);
  });
  it("the summary never looks empty: unset values read Not set", () => {
    const view = withFields([
      { path: "/studentId", label: "Student", kind: "entity", entity: "student", required: true },
      { path: "/dueOn", label: "Due on", kind: "date", required: false },
    ]);
    const lines = summaryLines(view, {});
    expect(lines.map((l) => l.text)).toEqual(["Not set yet (required)", "Not set"]);
  });
});
