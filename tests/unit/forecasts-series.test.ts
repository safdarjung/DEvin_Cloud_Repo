// M21-T6 — series builders tests (RED first).
import { describe, it, expect } from "vitest";
import {
  buildFeeSeries,
  attendanceWindow,
  buildAttendanceSeries,
  isoWeek,
  historyEvidence,
  type FeeSeriesRow,
  type AttendanceSeriesRow,
} from "../../src/modules/forecasts/series.ts";

function feeRow(
  sequence: number,
  starts_on: string,
  window_end: string,
  collected_paise: number,
  billed_paise: number,
): FeeSeriesRow {
  return {
    term_id: `term-${sequence}`,
    sequence,
    name: `Term ${sequence}`,
    starts_on,
    window_end,
    collected_paise,
    billed_paise,
  };
}

describe("buildFeeSeries", () => {
  it("7 complete terms and 2 future rows -> 7 periods, 2 targets, seasonKeys t1..t3", () => {
    const rows: FeeSeriesRow[] = [
      feeRow(1, "2023-04-01", "2023-08-01", 1000, 1200),
      feeRow(2, "2023-08-01", "2023-12-01", 1100, 1300),
      feeRow(3, "2023-12-01", "2024-04-01", 1200, 1400),
      feeRow(1, "2024-04-01", "2024-08-01", 1300, 1500),
      feeRow(2, "2024-08-01", "2024-12-01", 1400, 1600),
      feeRow(3, "2024-12-01", "2025-04-01", 1500, 1700),
      feeRow(1, "2025-04-01", "2025-08-01", 1600, 1800),
      // future rows (window_end > asOf)
      feeRow(2, "2025-08-01", "2025-12-01", 0, 0),
      feeRow(3, "2025-12-01", "2026-04-01", 0, 0),
    ];
    const asOf = "2025-09-15";
    const spec = buildFeeSeries(rows, asOf)!;
    expect(spec).not.toBeNull();
    expect(spec.periods).toHaveLength(7);
    expect(spec.targets).toHaveLength(2);
    expect(spec.periods.map((p) => p.seasonKey)).toEqual([
      "t1",
      "t2",
      "t3",
      "t1",
      "t2",
      "t3",
      "t1",
    ]);
    expect(spec.targets.map((t) => t.seasonKey)).toEqual(["t2", "t3"]);
    expect(spec.k).toBe(2);
    expect(spec.seriesKey).toBe("fees:term");
    expect(spec.unit).toBe("paise");
  });

  it("current open term (window_end > asOf) is a target, not a period", () => {
    const rows: FeeSeriesRow[] = [
      feeRow(1, "2025-04-01", "2025-08-01", 1000, 1200),
      feeRow(2, "2025-08-01", "2025-12-01", 1100, 1300), // open on asOf
    ];
    const asOf = "2025-09-15";
    const spec = buildFeeSeries(rows, asOf)!;
    expect(spec.periods.map((p) => p.start)).toEqual(["2025-04-01"]);
    expect(spec.targets.map((t) => t.start)).toEqual(["2025-08-01"]);
  });

  it("no future terms -> zero targets -> no forecast (null)", () => {
    const rows: FeeSeriesRow[] = [feeRow(1, "2025-04-01", "2025-08-01", 1000, 1200)];
    const spec = buildFeeSeries(rows, "2026-01-01");
    expect(spec).toBeNull();
  });

  it("no complete period -> null", () => {
    const rows: FeeSeriesRow[] = [feeRow(1, "2025-04-01", "2025-08-01", 1000, 1200)];
    const spec = buildFeeSeries(rows, "2025-01-01");
    expect(spec).toBeNull();
  });

  it("billed map keyed by period start, history evidence carries billed for fees", () => {
    const rows: FeeSeriesRow[] = [
      feeRow(1, "2025-04-01", "2025-08-01", 1000, 1200),
      feeRow(2, "2025-08-01", "2025-12-01", 1100, 1300),
      feeRow(3, "2025-12-01", "2026-04-01", 0, 0),
    ];
    const spec = buildFeeSeries(rows, "2026-01-01")!;
    expect(spec.billed["2025-04-01"]).toBe(1200);
    const history = historyEvidence(spec);
    expect(history[0]).toEqual({ start: "2025-04-01", label: "Term 1", value: 1000, billed: 1200 });
  });
});

describe("attendanceWindow", () => {
  it("as_of 2026-11-04 -> 2025-10-06 .. 2026-11-02", () => {
    expect(attendanceWindow("2026-11-04")).toEqual({ from: "2025-10-06", to: "2026-11-02" });
  });
});

function points(entries: [string, number, number][]) {
  return entries.map(([week_start, present, denominator]) => ({ week_start, present, denominator }));
}

describe("buildAttendanceSeries", () => {
  const asOf = "2026-11-04"; // monday0 = 2026-11-02

  it("weeks with denominator 0 are dropped, rate rounded to 2dp", () => {
    const rows: AttendanceSeriesRow[] = [
      {
        class_section_id: null,
        points: points([
          ["2026-10-19", 10, 0],
          ["2026-10-26", 7, 9],
        ]),
      },
    ];
    const [spec] = buildAttendanceSeries(rows, asOf);
    expect(spec.periods).toHaveLength(1);
    expect(spec.periods[0].value).toBe(77.78);
  });

  it("targets are the 3 Mondays from monday0", () => {
    const rows: AttendanceSeriesRow[] = [
      { class_section_id: null, points: points([["2026-10-26", 9, 10]]) },
    ];
    const [spec] = buildAttendanceSeries(rows, asOf);
    expect(spec.targets.map((t) => t.start)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(spec.k).toBe(4);
    expect(spec.unit).toBe("pct");
  });

  it("a section whose last week is 5 weeks old is skipped (stale)", () => {
    const fiveWeeksAgo = "2026-09-28"; // monday0(2026-11-02) - 35 days
    const rows: AttendanceSeriesRow[] = [
      { class_section_id: "sec-1", points: points([[fiveWeeksAgo, 9, 10]]) },
    ];
    expect(buildAttendanceSeries(rows, asOf)).toEqual([]);
  });

  it("null class_section_id -> attendance:school, section id -> attendance:section:<id>", () => {
    const rows: AttendanceSeriesRow[] = [
      { class_section_id: null, points: points([["2026-10-26", 9, 10]]) },
      { class_section_id: "sec-1", points: points([["2026-10-26", 8, 10]]) },
    ];
    const [school, section] = buildAttendanceSeries(rows, asOf);
    expect(school.seriesKey).toBe("attendance:school");
    expect(school.classSectionId).toBeNull();
    expect(school.kind).toBe("attendance_rate_week");
    expect(section.seriesKey).toBe("attendance:section:sec-1");
    expect(section.classSectionId).toBe("sec-1");
  });
});

describe("isoWeek", () => {
  it("2026-12-28 -> 2026-W53", () => {
    expect(isoWeek("2026-12-28")).toEqual({ label: "2026-W53", week: 53 });
  });

  it("2027-01-04 -> 2027-W01", () => {
    expect(isoWeek("2027-01-04")).toEqual({ label: "2027-W01", week: 1 });
  });
});
