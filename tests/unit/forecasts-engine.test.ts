// M21-T5 — pure forecast engine tests (RED first).
import { describe, it, expect } from "vitest";
import {
  HOLDOUT,
  predict,
  mape,
  runSeries,
  type Period,
  type Target,
} from "../../src/modules/forecasts/engine.ts";

describe("forecasts engine", () => {
  it("HOLDOUT is 3", () => {
    expect(HOLDOUT).toBe(3);
  });

  it("selects seasonal_naive_v1 for a strongly seasonal series with lower MAPE", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "t1" },
      { start: "p1", label: "p1", value: 200, seasonKey: "t2" },
      { start: "p2", label: "p2", value: 300, seasonKey: "t3" },
      { start: "p3", label: "p3", value: 110, seasonKey: "t1" },
      { start: "p4", label: "p4", value: 210, seasonKey: "t2" },
      { start: "p5", label: "p5", value: 310, seasonKey: "t3" },
      { start: "p6", label: "p6", value: 120, seasonKey: "t1" },
    ];
    const targets: Target[] = [
      { start: "p7", label: "p7", seasonKey: "t2" },
      { start: "p8", label: "p8", seasonKey: "t3" },
      { start: "p9", label: "p9", seasonKey: "t1" },
    ];
    const result = runSeries(periods, targets, { k: 3, unit: "paise" });
    const seasonal = result.backtests.find((b) => b.model === "seasonal_naive_v1");
    const moving = result.backtests.find((b) => b.model === "moving_average_v1");
    expect(seasonal).toBeDefined();
    expect(moving).toBeDefined();
    expect(seasonal!.mape).toBeLessThan(moving!.mape);
    expect(result.selected).toBe("seasonal_naive_v1");
    expect(result.forecast).toHaveLength(3);
  });

  it("selects moving_average_v1 for a flat series with no season matches", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "w0" },
      { start: "p1", label: "p1", value: 102, seasonKey: "w1" },
      { start: "p2", label: "p2", value: 99, seasonKey: "w2" },
      { start: "p3", label: "p3", value: 101, seasonKey: "w3" },
      { start: "p4", label: "p4", value: 100, seasonKey: "w4" },
    ];
    const targets: Target[] = [{ start: "p5", label: "p5", seasonKey: "w5" }];
    const result = runSeries(periods, targets, { k: 2, unit: "pct" });
    expect(result.backtests.find((b) => b.model === "seasonal_naive_v1")).toBeUndefined();
    expect(result.selected).toBe("moving_average_v1");
  });

  it("breaks an exact MAPE tie in favor of moving_average_v1", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s" },
      { start: "p1", label: "p1", value: 110, seasonKey: "s" },
      { start: "p2", label: "p2", value: 90, seasonKey: "s" },
      { start: "p3", label: "p3", value: 95, seasonKey: "s" },
    ];
    const targets: Target[] = [{ start: "p4", label: "p4", seasonKey: "s" }];
    const result = runSeries(periods, targets, { k: 1, unit: "paise" });
    const seasonal = result.backtests.find((b) => b.model === "seasonal_naive_v1");
    const moving = result.backtests.find((b) => b.model === "moving_average_v1");
    expect(seasonal!.mape).toBe(moving!.mape);
    expect(result.selected).toBe("moving_average_v1");
  });

  it("returns no backtests and no forecast for only 3 periods", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s0" },
      { start: "p1", label: "p1", value: 110, seasonKey: "s1" },
      { start: "p2", label: "p2", value: 90, seasonKey: "s2" },
    ];
    const targets: Target[] = [{ start: "p3", label: "p3", seasonKey: "s3" }];
    const result = runSeries(periods, targets, { k: 2, unit: "paise" });
    expect(result.backtests).toHaveLength(0);
    expect(result.selected).toBeNull();
    expect(result.forecast).toHaveLength(0);
  });

  it("drops a model whose held-out actuals are all zero", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s" },
      { start: "p1", label: "p1", value: 0, seasonKey: "s" },
      { start: "p2", label: "p2", value: 0, seasonKey: "s" },
      { start: "p3", label: "p3", value: 0, seasonKey: "s" },
    ];
    const targets: Target[] = [{ start: "p4", label: "p4", seasonKey: "s" }];
    const result = runSeries(periods, targets, { k: 1, unit: "paise" });
    expect(result.backtests).toHaveLength(0);
    expect(result.selected).toBeNull();
  });

  it("skips a zero actual in the MAPE average but keeps the backtest", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s" },
      { start: "p1", label: "p1", value: 0, seasonKey: "s" },
      { start: "p2", label: "p2", value: 110, seasonKey: "s" },
      { start: "p3", label: "p3", value: 90, seasonKey: "s" },
    ];
    const targets: Target[] = [{ start: "p4", label: "p4", seasonKey: "s" }];
    const result = runSeries(periods, targets, { k: 1, unit: "paise" });
    const moving = result.backtests.find((b) => b.model === "moving_average_v1")!;
    expect(moving).toBeDefined();
    expect(moving.holdout).toHaveLength(3);
    // prediction flat at 100 (k=1, train=[100]); errs: |110-100|/110, |90-100|/90; zero-actual pair skipped
    const expected = Math.round((((110 - 100) / 110 + (100 - 90) / 90) / 2) * 10000) / 10000;
    expect(moving.mape).toBe(expected);
  });

  it("marks seasonal_naive_v1 ineligible when a target's seasonKey has no match, though backtested", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "t1" },
      { start: "p1", label: "p1", value: 200, seasonKey: "t2" },
      { start: "p2", label: "p2", value: 300, seasonKey: "t3" },
      { start: "p3", label: "p3", value: 110, seasonKey: "t1" },
      { start: "p4", label: "p4", value: 210, seasonKey: "t2" },
      { start: "p5", label: "p5", value: 310, seasonKey: "t3" },
      { start: "p6", label: "p6", value: 120, seasonKey: "t1" },
    ];
    const targets: Target[] = [{ start: "p7", label: "p7", seasonKey: "zzz" }];
    const result = runSeries(periods, targets, { k: 3, unit: "paise" });
    expect(result.backtests.find((b) => b.model === "seasonal_naive_v1")).toBeDefined();
    expect(result.selected).not.toBe("seasonal_naive_v1");
  });

  it("widens the band with sqrt(h), keeps lower >= 0, and caps pct at 100", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 96, seasonKey: "s" },
      { start: "p1", label: "p1", value: 97, seasonKey: "s" },
      { start: "p2", label: "p2", value: 95, seasonKey: "s" },
      { start: "p3", label: "p3", value: 98, seasonKey: "s" },
      { start: "p4", label: "p4", value: 94, seasonKey: "s" },
    ];
    const targets: Target[] = [
      { start: "p5", label: "p5", seasonKey: "s" },
      { start: "p6", label: "p6", seasonKey: "s" },
      { start: "p7", label: "p7", seasonKey: "s" },
    ];
    const result = runSeries(periods, targets, { k: 1, unit: "pct" });
    expect(result.forecast).toHaveLength(3);
    for (const point of result.forecast) {
      expect(point.lower).toBeGreaterThanOrEqual(0);
      expect(point.upper).toBeLessThanOrEqual(100);
      expect(point.point).toBeLessThanOrEqual(100);
    }
    const band = result.forecast.map((p) => p.upper - p.lower);
    expect(band[1]).toBeGreaterThan(band[0]);
    expect(band[2]).toBeGreaterThan(band[1]);
  });

  it("rounds paise outputs to integers", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 10033, seasonKey: "s" },
      { start: "p1", label: "p1", value: 10234, seasonKey: "s" },
      { start: "p2", label: "p2", value: 9871, seasonKey: "s" },
      { start: "p3", label: "p3", value: 10120, seasonKey: "s" },
    ];
    const targets: Target[] = [{ start: "p4", label: "p4", seasonKey: "s" }];
    const result = runSeries(periods, targets, { k: 2, unit: "paise" });
    expect(result.forecast).toHaveLength(1);
    const [point] = result.forecast;
    expect(Number.isInteger(point.point)).toBe(true);
    expect(Number.isInteger(point.lower)).toBe(true);
    expect(Number.isInteger(point.upper)).toBe(true);
  });

  it("derives confidence as 1 - mape clamped to [0, 1]", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s" },
      { start: "p1", label: "p1", value: 110, seasonKey: "s" },
      { start: "p2", label: "p2", value: 90, seasonKey: "s" },
      { start: "p3", label: "p3", value: 95, seasonKey: "s" },
    ];
    const targets: Target[] = [{ start: "p4", label: "p4", seasonKey: "s" }];
    const result = runSeries(periods, targets, { k: 1, unit: "paise" });
    const selectedBt = result.backtests.find((b) => b.model === result.selected)!;
    const expected = Math.round(Math.min(1, Math.max(0, 1 - selectedBt.mape)) * 1000) / 1000;
    expect(result.confidence).toBe(expected);
  });

  it("returns backtests with a null selected model and empty forecast when there are no targets", () => {
    const periods: Period[] = [
      { start: "p0", label: "p0", value: 100, seasonKey: "s" },
      { start: "p1", label: "p1", value: 110, seasonKey: "s" },
      { start: "p2", label: "p2", value: 90, seasonKey: "s" },
      { start: "p3", label: "p3", value: 95, seasonKey: "s" },
    ];
    const result = runSeries(periods, [], { k: 1, unit: "paise" });
    expect(result.backtests.length).toBeGreaterThan(0);
    expect(result.selected).toBeNull();
    expect(result.forecast).toHaveLength(0);
  });

  describe("predict", () => {
    it("returns null when fewer than k training periods for moving_average_v1", () => {
      const train: Period[] = [{ start: "p0", label: "p0", value: 1, seasonKey: "s" }];
      const target: Target = { start: "p1", label: "p1", seasonKey: "s" };
      expect(predict("moving_average_v1", train, target, 2)).toBeNull();
    });

    it("returns null for seasonal_naive_v1 with no matching seasonKey", () => {
      const train: Period[] = [{ start: "p0", label: "p0", value: 1, seasonKey: "a" }];
      const target: Target = { start: "p1", label: "p1", seasonKey: "b" };
      expect(predict("seasonal_naive_v1", train, target, 1)).toBeNull();
    });
  });

  describe("mape", () => {
    it("returns null when every actual is zero", () => {
      expect(mape([{ actual: 0, predicted: 5 }])).toBeNull();
    });

    it("skips zero-actual pairs and rounds to 4dp", () => {
      const result = mape([
        { actual: 0, predicted: 5 },
        { actual: 10, predicted: 9 },
      ]);
      expect(result).toBe(0.1);
    });
  });
});
