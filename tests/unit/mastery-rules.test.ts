import { describe, it, expect } from "vitest";
import {
  GAP_THRESHOLD,
  MIN_CONFIDENCE,
  masteryPct,
  gapsFrom,
  trendFrom,
  classifyStudent,
  gapSeverity,
  gapConfidence,
  gapEvidence,
  gapPattern,
  proposeIntervention,
  type MasteryGap,
  type MasteryStats,
  type UnitScore,
} from "../../src/modules/mastery/rules";

const unit = (over: Partial<UnitScore> = {}): UnitScore => ({
  subject: "Maths",
  topic: "Fractions",
  sequence: 1,
  score: 0.5,
  confidence: 0.5,
  ...over,
});

const stats = (over: Partial<MasteryStats> = {}): MasteryStats => ({
  gapUnits: 0,
  confidentUnits: 6,
  meanScore: 0.7,
  ...over,
});

describe("masteryPct", () => {
  it("rounds score to a percentage", () => {
    expect(masteryPct(0.591)).toBe(59);
    expect(masteryPct(0.0)).toBe(0);
    expect(masteryPct(1)).toBe(100);
  });
});

describe("gapsFrom", () => {
  it("excludes a unit at exactly the thresholds (score 0.6 / confidence 0.5)", () => {
    expect(gapsFrom([unit({ score: GAP_THRESHOLD, confidence: MIN_CONFIDENCE })])).toEqual([]);
  });

  it("includes a unit just below the score threshold", () => {
    const gaps = gapsFrom([unit({ score: 0.599, confidence: 0.5 })]);
    expect(gaps).toEqual([{ subject: "Maths", topic: "Fractions", mastery_pct: 60 }]);
  });

  it("never treats a low-confidence unit as a gap", () => {
    expect(gapsFrom([unit({ score: 0.1, confidence: 0.49 })])).toEqual([]);
  });

  it("sorts by score asc, then subject name, then sequence", () => {
    const gaps = gapsFrom([
      unit({ subject: "Science", topic: "Forces", sequence: 2, score: 0.3, confidence: 0.5 }),
      unit({ subject: "Maths", topic: "Fractions", sequence: 2, score: 0.3, confidence: 0.5 }),
      unit({ subject: "Maths", topic: "Algebra", sequence: 1, score: 0.1, confidence: 0.5 }),
    ]);
    expect(gaps.map((g) => g.topic)).toEqual(["Algebra", "Fractions", "Forces"]);
  });
});

describe("trendFrom", () => {
  it("is flat with fewer than 2 points", () => {
    expect(trendFrom([60])).toBe("flat");
    expect(trendFrom([])).toBe("flat");
  });

  it("is down when the last drops at least 5 vs the previous", () => {
    expect(trendFrom([72, 60])).toBe("down");
  });

  it("is flat when the delta is within ±5", () => {
    expect(trendFrom([60, 64])).toBe("flat");
  });

  it("is up when the last gains at least 5 vs the previous", () => {
    expect(trendFrom([60, 66])).toBe("up");
  });
});

describe("classifyStudent", () => {
  const ctx = (over: Partial<{ trend: "up" | "flat" | "down"; attendancePct: number | null; hasActivePlan: boolean }> = {}) => ({
    trend: "flat" as const,
    attendancePct: 90,
    hasActivePlan: false,
    ...over,
  });

  it("is support at 3+ gap units", () => {
    expect(classifyStudent(stats({ gapUnits: 3 }), ctx()).risk).toBe("support");
  });

  it("is support when meanScore is below 0.40", () => {
    expect(classifyStudent(stats({ meanScore: 0.39 }), ctx()).risk).toBe("support");
  });

  it("is watch with 1 gap unit", () => {
    expect(classifyStudent(stats({ gapUnits: 1 }), ctx()).risk).toBe("watch");
  });

  it("is watch below 75% attendance", () => {
    expect(classifyStudent(stats(), ctx({ attendancePct: 74.9 })).risk).toBe("watch");
  });

  it("is none when attendance is null and nothing else trips", () => {
    expect(classifyStudent(stats(), ctx({ attendancePct: null })).risk).toBe("none");
  });

  it("orders flags exactly: gap count, low mastery, declining, attendance, low evidence, intervention active", () => {
    const { flags } = classifyStudent(
      stats({ gapUnits: 2, confidentUnits: 0, meanScore: 0.3 }),
      ctx({ trend: "down", attendancePct: 50, hasActivePlan: true })
    );
    expect(flags).toEqual([
      "2 unit gaps",
      "Low mastery",
      "Declining results",
      "Attendance below 75%",
      "Low evidence",
      "Intervention active",
    ]);
  });

  it("singularizes the gap flag at exactly 1", () => {
    expect(classifyStudent(stats({ gapUnits: 1 }), ctx()).flags).toContain("1 unit gap");
  });
});

describe("gapSeverity", () => {
  it("is critical at 6 gap units", () => {
    expect(gapSeverity(stats({ gapUnits: 6 }))).toBe("critical");
  });

  it("is critical at mean score 0.24", () => {
    expect(gapSeverity(stats({ meanScore: 0.24 }))).toBe("critical");
  });

  it("is warning otherwise", () => {
    expect(gapSeverity(stats({ gapUnits: 5, meanScore: 0.5 }))).toBe("warning");
  });
});

describe("gapConfidence", () => {
  it("scales confident units over 6, capped at 1", () => {
    expect(gapConfidence(stats({ confidentUnits: 0 }))).toBe(0);
    expect(gapConfidence(stats({ confidentUnits: 3 }))).toBe(0.5);
    expect(gapConfidence(stats({ confidentUnits: 12 }))).toBe(1);
  });
});

describe("gapEvidence", () => {
  const gaps: MasteryGap[] = [
    { subject: "Maths", topic: "Fractions", mastery_pct: 40 },
    { subject: "Science", topic: "Forces", mastery_pct: 55 },
  ];

  it("includes overall mastery when meanScore is present", () => {
    const evidence = gapEvidence(stats({ gapUnits: 2, confidentUnits: 4, meanScore: 0.42 }), gaps);
    expect(evidence).toEqual([
      { label: "Gap units", value: 2 },
      { label: "Overall mastery", value: 42, unit: "%" },
      { label: "Units assessed", value: 4 },
      { label: "Maths · Fractions", value: 40, unit: "%" },
      { label: "Science · Forces", value: 55, unit: "%" },
    ]);
  });

  it("omits Overall mastery when meanScore is null", () => {
    const evidence = gapEvidence(stats({ gapUnits: 1, confidentUnits: 0, meanScore: null }), []);
    expect(evidence.find((e) => e.label === "Overall mastery")).toBeUndefined();
  });

  it("caps weakest-gap entries at 5", () => {
    const many: MasteryGap[] = Array.from({ length: 8 }, (_, i) => ({
      subject: "Maths",
      topic: `Unit ${i}`,
      mastery_pct: i,
    }));
    const evidence = gapEvidence(stats({ confidentUnits: 6 }), many);
    expect(evidence.length).toBe(3 + 5);
  });
});

describe("gapPattern", () => {
  it("reports n/a when meanScore is null", () => {
    expect(gapPattern(stats({ gapUnits: 2, meanScore: null }))).toBe("2 units below 60% mastery; overall n/a");
  });

  it("reports the rounded percentage when present", () => {
    expect(gapPattern(stats({ gapUnits: 3, meanScore: 0.417 }))).toBe("3 units below 60% mastery; overall 42%");
  });
});

describe("proposeIntervention", () => {
  const gaps: MasteryGap[] = Array.from({ length: 5 }, (_, i) => ({
    subject: "Maths",
    topic: `Unit ${i}`,
    mastery_pct: i * 10,
  }));

  it("caps steps at MAX_PLAN_GAPS, due +7/+14/+21, re-assess and review at +28", () => {
    const plan = proposeIntervention(gaps, "2026-01-01");
    expect(plan.steps.map((s) => s.due)).toEqual(["2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
    expect(plan.steps[3].title).toBe("Re-assess gap units");
    expect(plan.reviewDate).toBe("2026-01-29");
    expect(plan.goal).toBe("Raise 3 gap units to 60% mastery");
  });

  it("keeps every step title at or under 120 chars", () => {
    const plan = proposeIntervention(gaps, "2026-01-01");
    for (const step of plan.steps) {
      expect(step.title.length).toBeLessThanOrEqual(120);
    }
  });

  it("singularizes the goal with exactly 1 gap", () => {
    const plan = proposeIntervention([gaps[0]], "2026-01-01");
    expect(plan.goal).toBe("Raise 1 gap unit to 60% mastery");
  });

  it("handles zero gaps with only the re-assess step", () => {
    const plan = proposeIntervention([], "2026-01-01");
    expect(plan.steps).toEqual([{ title: "Re-assess gap units", due: "2026-01-08", done: false }]);
    expect(plan.reviewDate).toBe("2026-01-08");
    expect(plan.goal).toBe("Raise 0 gap units to 60% mastery");
  });
});
