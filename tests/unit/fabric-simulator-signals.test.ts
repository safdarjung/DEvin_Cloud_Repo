// Simulator real-signal helpers (simulator.queries.ts): fee forecast overlay,
// admissions-pipeline enrolment hint, real teacher load from the timetable.
import { describe, expect, it } from "vitest";
import { avgTeacherPeriodsWeek, forecastByMonth, pipelineEnrolmentHint } from "@/modules/fabric/simulator.queries";
import type { FinanceForecastPoint } from "@/modules/fabric/types";

const history = (month: string, collected: number, billed: number): FinanceForecastPoint => ({
  month,
  collected_paise: collected,
  expected_paise: billed,
  forecast_low_paise: collected,
  forecast_high_paise: collected,
});
const forecast = (month: string, point: number): FinanceForecastPoint => ({
  month,
  collected_paise: 0,
  expected_paise: point,
  forecast_low_paise: point - 50_000,
  forecast_high_paise: point + 50_000,
});

describe("forecastByMonth", () => {
  it("spreads each forecast term evenly over the months until the next term, in rupees", () => {
    const result = forecastByMonth([
      forecast("2027-04", 400_000),
      history("2026-04", 100_000, 120_000),
      history("2026-08", 90_000, 120_000),
      forecast("2026-12", 300_000),
    ]);
    expect(result).toEqual({
      "2026-12": 750,
      "2027-01": 750,
      "2027-02": 750,
      "2027-03": 750,
      // last term: reuses the previous term's 4-month span
      "2027-04": 1000,
      "2027-05": 1000,
      "2027-06": 1000,
      "2027-07": 1000,
    });
  });

  it("ignores history terms, even one with nothing collected", () => {
    expect(forecastByMonth([history("2026-04", 0, 120_000), history("2026-08", 90_000, 120_000)])).toEqual({});
  });

  it("returns nothing for a lone forecast term whose length can't be inferred", () => {
    expect(forecastByMonth([forecast("2026-12", 300_000)])).toEqual({});
  });
});

describe("pipelineEnrolmentHint", () => {
  const funnel = (offered: number, accepted: number) => ({
    enquiryStages: {},
    applicationStatuses: {
      submitted: 5,
      under_review: 4,
      interaction_scheduled: 1,
      offered,
      accepted,
      rejected: 2,
      withdrawn: 1,
      enrolled: 30,
    },
  });

  it("counts offered + accepted applications as a whole-percent enrolment delta", () => {
    expect(pipelineEnrolmentHint(funnel(12, 6), 600)).toEqual({ pending: 18, pct: 3 });
  });

  it("caps the hint at the slider's +30% maximum", () => {
    expect(pipelineEnrolmentHint(funnel(400, 0), 600)).toEqual({ pending: 400, pct: 30 });
  });

  it("returns null with no pending offers or no enrolled students", () => {
    expect(pipelineEnrolmentHint(funnel(0, 0), 600)).toBeNull();
    expect(pipelineEnrolmentHint(funnel(5, 0), 0)).toBeNull();
  });
});

describe("avgTeacherPeriodsWeek", () => {
  it("averages periods/week to one decimal, null with no teachers", () => {
    expect(avgTeacherPeriodsWeek([{ periods_week: 30 }, { periods_week: 25 }, { periods_week: 26 }])).toBe(27);
    expect(avgTeacherPeriodsWeek([{ periods_week: 30 }, { periods_week: 25 }])).toBe(27.5);
    expect(avgTeacherPeriodsWeek([])).toBeNull();
  });
});
