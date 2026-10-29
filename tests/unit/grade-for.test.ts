import { describe, expect, it } from "vitest";
import { DEFAULT_GRADING_BANDS, gradeFor } from "@/modules/exams/grade";

// T-019 AC4 — boundaries named by the packet, against the TS mirror of
// app.grade_for (20261028000001_foundation.sql). tests/db/exams-publish.test.ts
// compares the same boundaries against the real SQL function.
describe("gradeFor (TS mirror of app.grade_for, 05 §4.1 boundaries)", () => {
  it.each([
    [32.99, "E1"],
    [33, "D"],
    [40, "D"],
    [41, "C2"],
    [90.99, "A2"],
    [91, "A1"],
    [100, "A1"],
  ])("%s%% -> %s", (percentage, expected) => {
    expect(gradeFor(DEFAULT_GRADING_BANDS, percentage)).toBe(expected);
  });

  it("throws when no band matches (defensive — bands should always cover 0-100)", () => {
    expect(() => gradeFor(DEFAULT_GRADING_BANDS, 150)).toThrow(/No grade band/);
  });
});
