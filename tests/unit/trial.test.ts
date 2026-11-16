import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, trialStatus } from "@/modules/core/setup/trial";

const DAY = 24 * 60 * 60 * 1000;
const created = "2026-11-01T10:00:00.000Z";
const at = (days: number) => new Date(Date.parse(created) + days * DAY);

describe("trialStatus", () => {
  it("counts the full trial on day 0", () => {
    expect(trialStatus(created, at(0))).toEqual({ state: "active", daysLeft: TRIAL_DAYS });
  });
  it("rounds a partial day up", () => {
    expect(trialStatus(created, at(14.5))).toEqual({ state: "active", daysLeft: 1 });
  });
  it("ends exactly at 15 days", () => {
    expect(trialStatus(created, at(15))).toEqual({ state: "ended", daysLeft: 0 });
  });
  it("is none without a creation date or with a bad one", () => {
    expect(trialStatus(undefined, at(1))).toEqual({ state: "none", daysLeft: 0 });
    expect(trialStatus("not a date", at(1))).toEqual({ state: "none", daysLeft: 0 });
  });
});
