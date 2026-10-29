import { describe, expect, it } from "vitest";
import { computeAttendancePercentage, type AttendanceStatusOption } from "@/modules/attendance/queries";

// 05 §4.1 default statuses.
const STATUSES: Pick<AttendanceStatusOption, "code" | "countsPresent" | "inDenominator">[] = [
  { code: "P", countsPresent: 1, inDenominator: true },
  { code: "A", countsPresent: 0, inDenominator: true },
  { code: "L", countsPresent: 1, inDenominator: true },
  { code: "HD", countsPresent: 0.5, inDenominator: true },
  { code: "OL", countsPresent: 0, inDenominator: true },
];

describe("computeAttendancePercentage (AC5)", () => {
  it("returns 100% when every day is present", () => {
    const result = computeAttendancePercentage(["P", "P", "P", "P"], STATUSES);
    expect(result.percentage).toBe(100);
    expect(result.presentWeighted).toBe(4);
    expect(result.totalInDenominator).toBe(4);
  });

  it("returns 0% when every day is absent", () => {
    const result = computeAttendancePercentage(["A", "A"], STATUSES);
    expect(result.percentage).toBe(0);
  });

  it("weighs half days at 0.5, not 0 or 1", () => {
    const result = computeAttendancePercentage(["P", "P", "HD", "A"], STATUSES);
    // (1 + 1 + 0.5 + 0) / 4 = 62.5%
    expect(result.percentage).toBe(62.5);
  });

  it("boundary: exactly at the warn threshold (80%) is not below it", () => {
    const result = computeAttendancePercentage(["P", "P", "P", "P", "A"], STATUSES);
    expect(result.percentage).toBe(80);
  });

  it("boundary: one day below the critical threshold (75%)", () => {
    const result = computeAttendancePercentage(["P", "P", "P", "A"], STATUSES);
    expect(result.percentage).toBe(75);
  });

  it("late (L) counts as present (counts_present: 1)", () => {
    const result = computeAttendancePercentage(["L", "L"], STATUSES);
    expect(result.percentage).toBe(100);
  });

  it("a status code not in settings is ignored (not counted present or absent)", () => {
    const result = computeAttendancePercentage(["P", "X"], STATUSES);
    expect(result.totalInDenominator).toBe(1);
    expect(result.percentage).toBe(100);
  });

  it("returns 0% with no records at all (no division by zero)", () => {
    const result = computeAttendancePercentage([], STATUSES);
    expect(result.percentage).toBe(0);
    expect(result.totalInDenominator).toBe(0);
  });

  it("a status with in_denominator: false never affects the percentage", () => {
    const statusesWithExcluded = [...STATUSES, { code: "EXC", countsPresent: 1, inDenominator: false }];
    const result = computeAttendancePercentage(["P", "EXC"], statusesWithExcluded);
    expect(result.totalInDenominator).toBe(1);
    expect(result.percentage).toBe(100);
  });
});
