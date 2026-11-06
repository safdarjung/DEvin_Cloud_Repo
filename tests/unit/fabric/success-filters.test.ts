// F-UI-04 — pure roster filter (students lane). No DB: real StudentSuccessRow
// shape, filtered/sorted in memory the same way the roster UI does.
import { describe, it, expect } from "vitest";
import { filterRoster } from "@/modules/fabric/components/success/filters";
import type { StudentSuccessRow } from "@/modules/fabric/types";

function row(overrides: Partial<StudentSuccessRow>): StudentSuccessRow {
  return {
    student_id: "s1",
    name: "A",
    section_label: "6-A",
    attendance_pct: 90,
    mastery_pct: 80,
    trend: "flat",
    risk: "none",
    support_owner: null,
    last_contact: null,
    flags: [],
    gaps: [],
    ...overrides,
  };
}

const rows: StudentSuccessRow[] = [
  row({ student_id: "1", name: "Aisha Khan", section_label: "6-A", risk: "none", gaps: [] }),
  row({ student_id: "2", name: "Rohan Gupta", section_label: "6-B", risk: "watch", gaps: [{ subject: "Maths", topic: "Fractions", mastery_pct: 40 }] }),
  row({ student_id: "3", name: "Meera Iyer", section_label: "6-A", risk: "support", gaps: [{ subject: "Science", topic: "Cells", mastery_pct: 30 }] }),
];

describe("filterRoster", () => {
  it("returns every row when no filters are set", () => {
    expect(filterRoster(rows, {})).toHaveLength(3);
  });

  it("matches search against name case-insensitively", () => {
    const result = filterRoster(rows, { search: "rohan" });
    expect(result.map((r) => r.student_id)).toEqual(["2"]);
  });

  it("matches search against a gap subject or topic", () => {
    const result = filterRoster(rows, { search: "cells" });
    expect(result.map((r) => r.student_id)).toEqual(["3"]);
  });

  it("filters by section label", () => {
    const result = filterRoster(rows, { section: "6-A" });
    expect(result.map((r) => r.student_id)).toEqual(["1", "3"]);
  });

  it("filters by risk tier", () => {
    const result = filterRoster(rows, { risk: "support" });
    expect(result.map((r) => r.student_id)).toEqual(["3"]);
  });

  it("filters to rows with at least one gap when hasGaps is set", () => {
    const result = filterRoster(rows, { hasGaps: true });
    expect(result.map((r) => r.student_id)).toEqual(["2", "3"]);
  });

  it("combines filters", () => {
    const result = filterRoster(rows, { section: "6-A", hasGaps: true });
    expect(result.map((r) => r.student_id)).toEqual(["3"]);
  });
});
