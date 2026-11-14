import { describe, expect, it } from "vitest";
import { chartFromTool, tilesFromTool } from "@/modules/ai/components/orb/OrbDataChart";

const wrap = (d: unknown) => `<data-abc123>${JSON.stringify(d)}</data-abc123>`;

describe("stat tiles from tool results", () => {
  it("reads live tool output, whose nonce is a UUID with hyphens", () => {
    const live = `<data-af71726e-8ddf-49c4-81ba-f76b94d6cec8>${JSON.stringify({ totalActive: 30, sections: [{ section: "I-A", students: 30 }] })}</data-af71726e-8ddf-49c4-81ba-f76b94d6cec8>`;
    expect(tilesFromTool("tool-people_enrolmentCounts", live)?.[0]?.value).toBe(30);
    expect(chartFromTool("tool-attendance_attendanceTodaySummary", live.replace(/\{.*\}/, JSON.stringify({ studentsMarked: 2, percentage: 50, byStatus: [{ status: "Present", students: 1 }] })))?.rows).toHaveLength(1);
  });
  it("shows today's attendance as whole head counts and the percentage", () => {
    const t = tilesFromTool(
      "tool-attendance_attendanceTodaySummary",
      wrap({ percentage: 91.5, studentsMarked: 400, present: 366, absent: 34, halfDay: 0, byStatus: [], scope: "whole school" }),
    );
    expect(t).toEqual([
      { label: "Attendance", value: 91.5, decimals: 1, suffix: "%" },
      { label: "Students present", value: 366, decimals: 0, suffix: "" },
      { label: "Absent", value: 34, decimals: 0, suffix: "" },
      { label: "Marked", value: 400, decimals: 0, suffix: "" },
    ]);
  });
  it("shows enrolment totals and never invents figures", () => {
    expect(tilesFromTool("tool-people_enrolmentCounts", wrap({ totalActive: 812, sections: [{ section: "8-A", students: 40 }, { section: "8-B", students: 0 }] }))).toEqual([
      { label: "Students", value: 812, decimals: 0, suffix: "" },
      { label: "Classes", value: 1, decimals: 0, suffix: "" },
    ]);
    // A list cut to fit the model: no class count (it would be short).
    expect(tilesFromTool("tool-people_enrolmentCounts", wrap({ truncated: "sections: showing 60 of 72", totalActive: 3024, sections: [{ section: "I-A", students: 42 }] }))).toEqual([
      { label: "Students", value: 3024, decimals: 0, suffix: "" },
    ]);
    // Nothing marked yet: no tiles (a 0% tile would read as everyone absent).
    expect(tilesFromTool("tool-attendance_attendanceTodaySummary", wrap({ percentage: null, studentsMarked: 0, present: 0, absent: 0 }))).toBeNull();
    expect(tilesFromTool("tool-attendance_attendanceTodaySummary", wrap({ studentsMarked: 10, present: "x" }))).toBeNull();
    expect(tilesFromTool("tool-people_listStudents", wrap({ students: [] }))).toBeNull();
    expect(tilesFromTool("tool-x", "not data")).toBeNull();
  });
});
