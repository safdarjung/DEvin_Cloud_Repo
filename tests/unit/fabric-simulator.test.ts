import { describe, expect, it } from "vitest";
import { BASELINE_FACTS, runScenario, scenarios, sensitivity } from "@/modules/fabric/demo/simulator";
import type { ScenarioAssumptions } from "@/modules/fabric/types";

const baseAssumptions: ScenarioAssumptions = {
  enrolment_delta_pct: 0,
  staff_delta: 0,
  fee_change_pct: 0,
  cost_change_pct: 0,
  periods_per_day: BASELINE_FACTS.periods_per_day,
  horizon_months: 6,
};

describe("runScenario", () => {
  it("is deterministic for the same inputs", () => {
    const a = runScenario(baseAssumptions);
    const b = runScenario(baseAssumptions);
    expect(a).toEqual(b);
  });

  it("raises revenue when enrolment rises 10%", () => {
    const base = runScenario(baseAssumptions);
    const bumped = runScenario({ ...baseAssumptions, enrolment_delta_pct: 10 });
    expect(bumped.revenue_paise[0]).toBeGreaterThan(base.revenue_paise[0]!);
  });

  it("raises cost when staff rises by 5", () => {
    const base = runScenario(baseAssumptions);
    const bumped = runScenario({ ...baseAssumptions, staff_delta: 5 });
    expect(bumped.cost_paise[0]).toBeGreaterThan(base.cost_paise[0]!);
  });

  it("widens the confidence band as horizon grows", () => {
    const short = runScenario({ ...baseAssumptions, horizon_months: 6 });
    const long = runScenario({ ...baseAssumptions, horizon_months: 24 });
    const shortBand = short.confidence_high_pct - short.confidence_low_pct;
    const longBand = long.confidence_high_pct - long.confidence_low_pct;
    expect(longBand).toBeGreaterThan(shortBand);
  });

  it("flags risk at extreme enrolment growth with no staff added", () => {
    const extreme = runScenario({ ...baseAssumptions, enrolment_delta_pct: 60, staff_delta: 0 });
    expect(extreme.risk_flags.length).toBeGreaterThan(0);
  });

  it("produces a month list of horizon_months length starting at the fixed start", () => {
    const result = runScenario({ ...baseAssumptions, horizon_months: 6 });
    expect(result.months).toHaveLength(6);
    expect(result.months[0]).toBe("2026-11");
  });
});

describe("sensitivity", () => {
  it("returns one row per assumption param (6 params)", () => {
    const rows = sensitivity(baseAssumptions);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.param).sort()).toEqual(
      [
        "cost_change_pct",
        "enrolment_delta_pct",
        "fee_change_pct",
        "horizon_months",
        "periods_per_day",
        "staff_delta",
      ].sort(),
    );
  });
});

describe("scenarios", () => {
  it("builds a baseline (approved, is_baseline) plus 4 saved scenarios with each status", () => {
    const rows = scenarios({ now: new Date("2026-10-31T00:00:00Z"), institutionId: "inst-1", seed: 7 });
    expect(rows).toHaveLength(5);
    const baseline = rows.find((s) => s.is_baseline);
    expect(baseline?.status).toBe("approved");
    const statuses = rows.filter((s) => !s.is_baseline).map((s) => s.status);
    expect(statuses.sort()).toEqual(["approved", "draft", "proposed", "rejected"]);
    for (const s of rows) {
      expect(s.results).not.toBeNull();
      expect(s.institution_id).toBe("inst-1");
    }
  });
});
