import { describe, expect, it } from "vitest";
import {
  assembleValues, buildInput, formatRupees, getAt, initialValues, isoToIstLocal, istLocalToIso, normalizeErrors, paiseToRupees,
  parseMarks, rowErrors, rupeesToPaise, scopeFor, setAt, summarizeErrors, validateAll,
} from "@/modules/ai/components/task-card/fields";
import { attendanceMark, expensesRecord, libraryLoanIssue } from "@/modules/ai/components/task-card/fixtures";
import { rosterCounts, rosterShape, setAllStatus } from "@/modules/ai/components/task-card/renderers";
import { approveVerb } from "@/modules/ai/components/task-card/summary";
import type { TaskFieldView, TaskView } from "@/modules/ai/tasks/types";

describe("rupees <-> paise", () => {
  it("converts exactly", () => {
    expect(rupeesToPaise("0.01")).toBe(1);
    expect(rupeesToPaise("1,00,000.50")).toBe(10000050);
    expect(rupeesToPaise("₹ 250")).toBe(25000);
    expect(rupeesToPaise("19.9")).toBe(1990);
    expect(rupeesToPaise("0")).toBe(0);
  });
  it("rejects 3 decimals, negatives and junk", () => {
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("-1")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("1e3")).toBeNull();
  });
  it("round-trips and formats Indian grouping", () => {
    expect(paiseToRupees(1)).toBe("0.01");
    expect(paiseToRupees(10000050)).toBe("100000.50");
    expect(paiseToRupees(10000)).toBe("100");
    expect(formatRupees(10000050)).toBe("₹1,00,000.50");
    expect(formatRupees(99900)).toBe("₹999");
    for (const p of [0, 5, 99, 100, 101, 123456789]) expect(rupeesToPaise(paiseToRupees(p))).toBe(p);
  });
});

describe("marks", () => {
  it("accepts up to 2 decimals and rejects others", () => {
    expect(parseMarks("18.5")).toBe(18.5);
    expect(parseMarks("0")).toBe(0);
    expect(parseMarks("18.555")).toBeNull();
    expect(parseMarks("-1")).toBeNull();
  });
});

describe("pointer paths and assembly", () => {
  it("builds the nested input from pointer entries", () => {
    expect(assembleValues({ "/a": 1, "/records/0/status": "absent", "/records/1/status": "late", "/n/x": true })).toEqual({
      a: 1, records: [{ status: "absent" }, { status: "late" }], n: { x: true },
    });
  });
  it("sets immutably", () => {
    const v = { records: [{ status: "present" }] };
    const next = setAt(v, "/records/0/status", "absent");
    expect(getAt(next, "/records/0/status")).toBe("absent");
    expect(v.records[0].status).toBe("present");
  });
});

describe("error mapping", () => {
  const view = attendanceMark().view;
  it("normalizes dotted keys and maps repeater rows", () => {
    const errs = normalizeErrors({ "/records/3/status": ["Not a valid status"], "records.1.studentId": ["Unknown student"], "/date": ["Required"] });
    expect(errs["/records/1/studentId"]).toEqual(["Unknown student"]);
    expect(Object.keys(rowErrors(errs, "/records", 3))).toEqual(["/records/3/status"]);
    expect(rowErrors(errs, "/records", 2)).toEqual({});
    const sum = summarizeErrors(view, {}, errs);
    expect(sum.find((s) => s.path === "/records/3/status")?.label).toBe("Row 4: Status");
    expect(sum.find((s) => s.path === "/date")?.label).toBe("Date");
  });
});

describe("human-only fields", () => {
  it("are never prefilled even if view.values holds them", () => {
    const view = expensesRecord().view;
    expect(view.values).toHaveProperty("amount");
    const v = initialValues(view);
    expect(v).not.toHaveProperty("amount");
    expect(v.description).toBe("Chalk and markers");
  });
  it("are required before approve", () => {
    const view = expensesRecord().view;
    const errs = validateAll(view, initialValues(view));
    expect(errs["/amount"]).toBeTruthy();
  });
  it("are cleared inside repeater rows too", () => {
    const fields: TaskFieldView[] = [
      { path: "/rows", label: "Row", kind: "array", required: true, fields: [{ path: "/rows/*/cost", label: "Cost", kind: "rupee_text", required: true, humanOnly: true }, { path: "/rows/*/n", label: "N", kind: "text", required: false }] },
    ];
    const view = { ...libraryLoanIssue().view, fields, values: { rows: [{ cost: "5", n: "a" }] } } as TaskView;
    expect(initialValues(view)).toEqual({ rows: [{ n: "a" }] });
  });
});

describe("buildInput", () => {
  it("converts money exactly and drops empties", () => {
    const fields: TaskFieldView[] = [
      { path: "/fee", label: "Fee", kind: "paise", required: true },
      { path: "/amount", label: "Amount", kind: "rupee_text", required: true },
      { path: "/pct", label: "Pct", kind: "rupees", required: false },
      { path: "/m", label: "Marks", kind: "marks", required: false },
      { path: "/skip", label: "Skip", kind: "text", required: false },
    ];
    const view = { ...libraryLoanIssue().view, fields, values: { fee: 10000050 } } as TaskView;
    const state = initialValues(view);
    expect(state.fee).toBe("100000.50");
    const out = buildInput(view, { ...state, amount: "1,250.5", pct: "12.5", m: "18", skip: "" });
    expect(out).toEqual({ fee: 10000050, amount: "1250.50", pct: 12.5, m: 18 });
  });
});

describe("register helpers", () => {
  it("counts and sets all", () => {
    const view = attendanceMark().view;
    const shape = rosterShape(view)!;
    const v = initialValues(view);
    expect(rosterCounts(v, shape)).toEqual({ present: 5, absent: 1, late: 0 });
    expect(rosterCounts(setAllStatus(v, shape, "late"), shape).late).toBe(6);
  });
  it("buildInput keeps register rows in order", () => {
    const view = attendanceMark().view;
    const out = buildInput(view, initialValues(view)) as { records: { studentId: string }[] };
    expect(out.records.map((r) => r.studentId)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
  });
});

describe("misc", () => {
  it("scopes pickers by sibling entities in the same row", () => {
    const fields: TaskFieldView[] = [
      { path: "/sectionId", label: "Section", kind: "entity", entity: "classSection", required: true },
      { path: "/subjectId", label: "Subject", kind: "entity", entity: "subject", required: true },
    ];
    const view = { ...libraryLoanIssue().view, fields } as TaskView;
    expect(scopeFor(view, { sectionId: "sec1" }, "/subjectId")).toEqual({ sectionId: "sec1" });
  });
  it("shows date-times in India time", () => {
    expect(isoToIstLocal("2026-11-11T00:00:00.000Z")).toBe("2026-11-11T05:30");
    expect(istLocalToIso("2026-11-11T05:30")).toBe("2026-11-11T00:00:00.000Z");
  });
  it("derives the approve verb", () => {
    expect(approveVerb("Issue a library book")).toBe("Issue book");
    expect(approveVerb("Mark attendance")).toBe("Mark attendance");
  });
});
