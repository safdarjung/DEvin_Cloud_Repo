import { describe, expect, it } from "vitest";
import { chartFromTool } from "@/modules/ai/components/orb/OrbDataChart";

const wrap = (d: unknown) => `<data-abc123>${JSON.stringify(d)}</data-abc123>`;

describe("charts from tool results", () => {
  it("draws grade counts in grade order and per-class scores largest first", () => {
    const g = chartFromTool("tool-exams_examGradeDistribution", wrap({ examName: "Half-Yearly", distribution: { B1: 5, A1: 2, C1: 1, A2: 3 } }));
    expect(g?.rows.map((r) => r.label)).toEqual(["A1", "A2", "B1", "C1"]);
    const s = chartFromTool("tool-exams_sectionScoreBands", wrap({ exam: "Half-Yearly", threshold: 70, sections: [{ section: "X-A", below: 3, students: 40 }, { section: "X-E", below: 9, students: 41 }] }));
    expect(s?.rows[0]).toEqual({ label: "X-E", value: 9, display: "9 of 41" });
    expect(s?.tone).toBe("warn");
  });
  it("reads rupee text and skips results a chart does not help", () => {
    const f = chartFromTool("tool-finance_termCollectionSummary", wrap({ collected: "₹2,95,55,800", outstanding: "₹2,96,35,550" }));
    expect(f?.rows.map((r) => r.value)).toEqual([29555800, 29635550]);
    expect(chartFromTool("tool-people_listStudents", wrap({ students: [] }))).toBeNull();
    expect(chartFromTool("tool-attendance_attendanceTodaySummary", wrap({ studentsMarked: 0, byStatus: [] }))).toBeNull();
    expect(chartFromTool("tool-x", "not data")).toBeNull();
  });
});
