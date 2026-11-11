import { describe, expect, it } from "vitest";
import { applyLayout } from "../../src/modules/core/dashboard-widgets";
import { DashboardLayoutSchema } from "../../src/modules/core/schemas";

const AVAILABLE = ["kpi-strip", "attendance-trend", "fees-by-class", "upcoming"];

describe("applyLayout", () => {
  it("returns the default order for an empty or missing layout", () => {
    expect(applyLayout(AVAILABLE, { hidden: [], order: [] })).toEqual(AVAILABLE);
    expect(applyLayout(AVAILABLE, null)).toEqual(AVAILABLE);
  });

  it("removes hidden widgets", () => {
    expect(applyLayout(AVAILABLE, { hidden: ["fees-by-class"], order: [] })).toEqual(["kpi-strip", "attendance-trend", "upcoming"]);
  });

  it("ignores ids the user is not entitled to or that do not exist", () => {
    expect(applyLayout(AVAILABLE, { hidden: ["top-defaulters"], order: ["top-defaulters", "upcoming", "nope"] })).toEqual([
      "upcoming",
      "kpi-strip",
      "attendance-trend",
      "fees-by-class",
    ]);
  });

  it("appends a newly added widget in default order after the saved order", () => {
    expect(applyLayout(["a", "b", "new", "c"], { hidden: [], order: ["c", "a", "b"] })).toEqual(["c", "a", "b", "new"]);
  });

  it("does not repeat a duplicated id", () => {
    expect(applyLayout(AVAILABLE, { hidden: [], order: ["upcoming", "upcoming"] })).toEqual(["upcoming", "kpi-strip", "attendance-trend", "fees-by-class"]);
  });
});

describe("DashboardLayoutSchema", () => {
  it("accepts registry ids and rejects unknown ids, extra keys and oversize lists", () => {
    expect(DashboardLayoutSchema.safeParse({ hidden: ["upcoming"], order: ["kpi-strip"] }).success).toBe(true);
    expect(DashboardLayoutSchema.safeParse({ hidden: ["bogus"], order: [] }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ hidden: [], order: [], extra: 1 }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ hidden: Array(60).fill("upcoming"), order: [] }).success).toBe(false);
  });
});
