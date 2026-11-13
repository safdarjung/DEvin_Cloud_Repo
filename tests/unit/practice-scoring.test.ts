import { describe, expect, it } from "vitest";
import { computeStreak, istDay, scoreAttempt, subjectAverages } from "@/modules/practice/scoring";

describe("scoreAttempt", () => {
  const qs = [{ answerIndex: 1 }, { answerIndex: 3 }, { answerIndex: 0 }];

  it("counts exact matches only", () => {
    expect(scoreAttempt(qs, [1, 0, 0])).toEqual({ score: 2, maxScore: 3 });
  });

  it("scores skipped (null) answers as zero", () => {
    expect(scoreAttempt(qs, [null, null, null])).toEqual({ score: 0, maxScore: 3 });
  });

  it("treats answer index 0 as an answer, not as missing", () => {
    expect(scoreAttempt([{ answerIndex: 0 }], [0])).toEqual({ score: 1, maxScore: 1 });
  });
});

describe("istDay", () => {
  it("rolls to the next day after 18:30 UTC", () => {
    expect(istDay("2026-11-05T18:29:00Z")).toBe("2026-11-05");
    expect(istDay("2026-11-05T18:30:00Z")).toBe("2026-11-06");
  });
});

describe("computeStreak", () => {
  const now = new Date("2026-11-06T06:00:00Z"); // 11:30 IST on 2026-11-06

  it("counts consecutive IST days ending today", () => {
    expect(computeStreak(["2026-11-06", "2026-11-05", "2026-11-04"], now)).toBe(3);
  });

  it("still counts when only yesterday is active", () => {
    expect(computeStreak(["2026-11-05", "2026-11-04"], now)).toBe(2);
  });

  it("is 0 when the latest activity is before yesterday", () => {
    expect(computeStreak(["2026-11-03"], now)).toBe(0);
  });

  it("stops at the first gap and ignores duplicate days", () => {
    expect(computeStreak(["2026-11-06", "2026-11-06T02:00:00Z", "2026-11-04"], now)).toBe(1);
  });

  it("buckets instants by IST day, not UTC", () => {
    // 2026-11-05T20:00Z is 01:30 IST on the 6th, so it counts as today.
    expect(computeStreak([new Date("2026-11-05T20:00:00Z")], now)).toBe(1);
  });

  it("is 0 with no activity", () => {
    expect(computeStreak([], now)).toBe(0);
  });
});

describe("subjectAverages", () => {
  it("averages each attempt's percentage per subject", () => {
    const result = subjectAverages([
      { subjectId: "m", score: 5, maxScore: 10 },
      { subjectId: "m", score: 10, maxScore: 10 },
      { subjectId: "s", score: 1, maxScore: 3 },
    ]);
    expect(result).toEqual([
      { subjectId: "m", attempts: 2, averagePercent: 75 },
      { subjectId: "s", attempts: 1, averagePercent: 33.3 },
    ]);
  });

  it("skips rows with a non-positive max score", () => {
    expect(subjectAverages([{ subjectId: "m", score: 0, maxScore: 0 }])).toEqual([]);
  });
});

describe("withSuperscripts (practice quiz display)", async () => {
  const { withSuperscripts } = await import("@/modules/practice/components/PracticeStudio");

  it("shows the model's caret powers as superscripts", () => {
    expect(withSuperscripts("Factorise 2x^2 - 4x")).toBe("Factorise 2x² - 4x");
    expect(withSuperscripts("x^{n+1} and 2^10 and a^-1")).toBe("xⁿ⁺¹ and 2¹⁰ and a⁻¹");
  });

  it("leaves text with no caret, or a power with no superscript form, as typed", () => {
    expect(withSuperscripts("x(x-2)")).toBe("x(x-2)");
    expect(withSuperscripts("e^{ab}")).toBe("e^{ab}");
  });
});
