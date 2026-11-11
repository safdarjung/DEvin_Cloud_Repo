// features-18 §D — Analysis lab pure logic: Monte Carlo bands, goal seek,
// AI-assumption clamp, the explain digit post-check, captions, attention ranking.
import { describe, expect, it } from "vitest";
import { BASELINE_FACTS, runScenario } from "@/modules/fabric/demo/simulator";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import {
  correlationCaption,
  goalSeekFeeChange,
  monteCarloSurplus,
  monthlySurplusPaise,
  rankAttention,
  type LabAnomalyRow,
} from "@/modules/fabric/lab";
import { clampScenarioAssumptions, findUnsupportedNumbers, LabExplainRequestSchema } from "@/modules/fabric/lab.schemas";

const BASE: ScenarioAssumptions = {
  enrolment_delta_pct: 0,
  staff_delta: 0,
  fee_change_pct: 0,
  cost_change_pct: 0,
  periods_per_day: 8,
  horizon_months: 12,
};

describe("monteCarloSurplus", () => {
  it("is deterministic for a given seed", () => {
    const a = monteCarloSurplus(BASE, BASELINE_FACTS, { sigmaPct: 8, seed: 42 });
    const b = monteCarloSurplus(BASE, BASELINE_FACTS, { sigmaPct: 8, seed: 42 });
    expect(a).toEqual(b);
    expect(a.runs).toBe(500);
  });

  it("a different seed gives a different band", () => {
    const a = monteCarloSurplus(BASE, BASELINE_FACTS, { sigmaPct: 8, seed: 1 });
    const b = monteCarloSurplus(BASE, BASELINE_FACTS, { sigmaPct: 8, seed: 2 });
    expect(a.p50).not.toEqual(b.p50);
  });

  it("keeps P10 <= P50 <= P90 every month, one point per horizon month", () => {
    const band = monteCarloSurplus({ ...BASE, horizon_months: 18 }, BASELINE_FACTS, { sigmaPct: 10, seed: 7 });
    expect(band.months).toHaveLength(18);
    for (let i = 0; i < band.months.length; i++) {
      expect(band.p10[i]!).toBeLessThanOrEqual(band.p50[i]!);
      expect(band.p50[i]!).toBeLessThanOrEqual(band.p90[i]!);
    }
    expect(band.p90[17]! - band.p10[17]!).toBeGreaterThan(0);
  });

  it("zero spread collapses the band onto the deterministic cumulative surplus", () => {
    const band = monteCarloSurplus(BASE, BASELINE_FACTS, { sigmaPct: 0, seed: 3 });
    const monthly = monthlySurplusPaise(BASE, BASELINE_FACTS);
    expect(band.p10[0]).toBe(monthly);
    expect(band.p90[11]).toBe(monthly * 12);
  });
});

describe("goalSeekFeeChange", () => {
  it("finds a known root inside the slider range", () => {
    const target = monthlySurplusPaise({ ...BASE, fee_change_pct: 7.3 }, BASELINE_FACTS);
    const result = goalSeekFeeChange(BASE, BASELINE_FACTS, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feeChangePct).toBeCloseTo(7.3, 1);
    expect(monthlySurplusPaise({ ...BASE, fee_change_pct: result.feeChangePct }, BASELINE_FACTS)).toBeGreaterThanOrEqual(target);
  });

  it("reports no solution when even the top of the range misses the target", () => {
    const result = goalSeekFeeChange(BASE, BASELINE_FACTS, 10_000_000_000);
    expect(result).toMatchObject({ ok: false, reason: "above_range", bestFeeChangePct: 25 });
  });

  it("returns the bottom of the range when even the lowest fee meets the target", () => {
    const result = goalSeekFeeChange(BASE, BASELINE_FACTS, -10_000_000_000);
    expect(result).toEqual({ ok: true, feeChangePct: -10 });
  });
});

describe("clampScenarioAssumptions", () => {
  it("clamps to slider ranges, rounds to slider steps, and drops null/non-finite keys", () => {
    expect(
      clampScenarioAssumptions({
        enrolment_delta_pct: 55,
        staff_delta: -40,
        fee_change_pct: 7.6,
        cost_change_pct: null,
        periods_per_day: Number.NaN,
        horizon_months: 3,
      }),
    ).toEqual({ enrolment_delta_pct: 30, staff_delta: -10, fee_change_pct: 8, horizon_months: 6 });
  });

  it("an all-null suggestion changes nothing", () => {
    expect(
      clampScenarioAssumptions({
        enrolment_delta_pct: null,
        staff_delta: null,
        fee_change_pct: null,
        cost_change_pct: null,
        periods_per_day: null,
        horizon_months: null,
      }),
    ).toEqual({});
  });
});

describe("findUnsupportedNumbers", () => {
  const input = JSON.stringify([{ group: "Grade 8-A", r: 0.62, n: 28, overdue_rupees: 123456, z: -2.1 }]);

  it("accepts output that only repeats numbers from the input", () => {
    expect(findUnsupportedNumbers("In Grade 8-A (n = 28), r = 0.62; z is 2.1 and ₹1,23,456 is overdue.", input)).toEqual([]);
  });

  it("treats 0.620 and 28.0 as the same numbers as 0.62 and 28", () => {
    expect(findUnsupportedNumbers("r = 0.620 across 28.0 students", input)).toEqual([]);
  });

  it("flags a number that is not in the input", () => {
    expect(findUnsupportedNumbers("Attendance rose 62% for 30 students.", input)).toEqual(["62", "30"]);
  });
});

describe("LabExplainRequestSchema", () => {
  it("accepts a panel kind with no ref and a section kind with a uuid", () => {
    expect(LabExplainRequestSchema.safeParse({ institutionSlug: "s", kind: "fee_risk", ref: null }).success).toBe(true);
    expect(
      LabExplainRequestSchema.safeParse({ institutionSlug: "s", kind: "section", ref: "7c9e6679-7425-40de-944b-e07fc1f90ae7" }).success,
    ).toBe(true);
  });

  it("rejects client-supplied numbers beside kind/ref", () => {
    expect(LabExplainRequestSchema.safeParse({ institutionSlug: "s", kind: "fee_risk", ref: null, numbers: [1, 2] }).success).toBe(false);
    expect(LabExplainRequestSchema.safeParse({ institutionSlug: "s", kind: "section", ref: "not-a-uuid" }).success).toBe(false);
  });
});

describe("correlationCaption", () => {
  const row = {
    class_section_id: "s1",
    grade: "Grade VIII",
    section: "A",
    subject_id: "m1",
    subject: "Mathematics",
    n: 28,
    avg_attendance_pct: 91.2,
    avg_mark_pct: 68.4,
  };

  it("says plainly that attendance and marks rise together for a positive r", () => {
    expect(correlationCaption({ ...row, pearson_r: 0.6234 })).toBe(
      "r = 0.62: students who attend more score higher in Mathematics (Grade VIII-A, n = 28).",
    );
  });

  it("calls a weak r a weak link and a null r no measurable link", () => {
    expect(correlationCaption({ ...row, pearson_r: 0.1 })).toContain("little link");
    expect(correlationCaption({ ...row, pearson_r: null })).toContain("no measurable link");
  });
});

describe("rankAttention", () => {
  const anomaly = (id: string, attendanceZ: number | null): LabAnomalyRow => ({
    class_section_id: id,
    grade: "Grade VI",
    section: id,
    students: 30,
    attendance_pct: 80,
    attendance_z: attendanceZ,
    avg_mark_pct: null,
    mark_z: null,
    fee_overdue_rate: null,
    fee_overdue_z: null,
  });

  it("puts critical conflicts and |z| >= 2 first, drops |z| < 1.5, keeps the node id for selection", () => {
    const nodes = [
      { id: "A", label: "VI-A" },
      { id: "B", label: "VI-B" },
      { id: "R1", label: "Room 1" },
    ];
    const items = rankAttention(nodes, { R1: { count: 2, severity: "critical" } }, [anomaly("A", -2.4), anomaly("B", 1.2)]);
    expect(items.map((i) => i.nodeId)).toEqual(["R1", "A"]);
    expect(items[1]).toMatchObject({ severity: "critical", label: "VI-A" });
  });
});

it("monthlySurplusPaise matches runScenario month 0", () => {
  const r = runScenario(BASE, BASELINE_FACTS);
  expect(monthlySurplusPaise(BASE, BASELINE_FACTS)).toBe(r.revenue_paise[0]! - r.cost_paise[0]!);
});
