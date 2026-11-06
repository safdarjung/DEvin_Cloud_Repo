import { describe, expect, test } from "vitest";
import { earnedMilestones } from "@/modules/practice/milestones";

describe("earnedMilestones", () => {
  test("no attempts earns nothing", () => {
    expect(earnedMilestones({ totalAttempts: 0, streak: 0, hasFullMarks: false })).toEqual([]);
  });
  test("only thresholds actually met are returned", () => {
    expect(earnedMilestones({ totalAttempts: 3, streak: 2, hasFullMarks: false })).toEqual(["First practice quiz completed"]);
    expect(earnedMilestones({ totalAttempts: 10, streak: 7, hasFullMarks: true })).toHaveLength(4);
  });
});
