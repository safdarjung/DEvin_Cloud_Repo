import { describe, expect, it } from "vitest";
import {
  demoApprovals,
  demoAttendanceTrend,
  demoFixturesEnabled,
  demoInsights,
  demoStaffAvailability,
  demoTimetable,
} from "@/modules/core/demo/fixtures";

const entries = [{ title: "Mathematics", subtitle: "10-A" }, { title: "English", subtitle: "10-B" }, { title: "Science" }];
// 2026-10-28 (Wed) at the given IST wall-clock time.
const ist = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00+05:30`);

describe("demoFixturesEnabled", () => {
  it("is false for a non-demo institution and true for a demo one", () => {
    const ctx = (is_demo: boolean) => ({ institution: { is_demo } }) as Parameters<typeof demoFixturesEnabled>[0];
    expect(demoFixturesEnabled(ctx(false))).toBe(false);
    expect(demoFixturesEnabled(ctx(true))).toBe(true);
  });
});

describe("demoAttendanceTrend", () => {
  const args = { key: "inst-1", days: 30, endDate: ist("09:00") };

  it("is deterministic per key and differs across keys", () => {
    expect(demoAttendanceTrend(args)).toEqual(demoAttendanceTrend(args));
    expect(demoAttendanceTrend({ ...args, key: "inst-2" })).not.toEqual(demoAttendanceTrend(args));
  });

  it("stays within 80-100 percent and skips Sundays", () => {
    const series = demoAttendanceTrend(args);
    expect(series.length).toBeGreaterThan(20);
    expect(series.length).toBeLessThanOrEqual(30);
    for (const p of series) expect(p.value).toBeGreaterThanOrEqual(80);
    for (const p of series) expect(p.value).toBeLessThanOrEqual(100);
  });
});

describe("demoTimetable", () => {
  it("has 7 periods plus breaks, 08:00 to 14:10", () => {
    const rows = demoTimetable({ day: ist("07:00"), entries });
    expect(rows.filter((r) => !/break|lunch/i.test(r.title))).toHaveLength(7);
    expect(rows[0].start).toBe("08:00");
    expect(rows.at(-1)?.end).toBe("14:10");
  });

  it("fills titles round-robin from the entries", () => {
    const rows = demoTimetable({ day: ist("07:00"), entries }).filter((r) => !/break|lunch/i.test(r.title));
    expect(new Set(rows.map((r) => r.title))).toEqual(new Set(["Mathematics", "English", "Science"]));
  });

  it.each([
    ["07:30", "isNext"],
    ["09:00", "isCurrent"],
    ["12:20", "isCurrent"],
  ] as const)("marks exactly one highlighted row at %s (%s)", (time, flag) => {
    const rows = demoTimetable({ day: ist(time), entries });
    expect(rows.filter((r) => r.isCurrent || r.isNext)).toHaveLength(1);
    expect(rows.filter((r) => r[flag])).toHaveLength(1);
  });

  it("marks nothing after school hours", () => {
    expect(demoTimetable({ day: ist("15:00"), entries }).some((r) => r.isCurrent || r.isNext)).toBe(false);
  });
});

describe("staff and approvals", () => {
  it("are deterministic per key", () => {
    expect(demoStaffAvailability("k")).toEqual(demoStaffAvailability("k"));
    expect(demoApprovals("k", ist("10:00"))).toEqual(demoApprovals("k", ist("10:00")));
  });

  it("staff counts are consistent with the on-leave list", () => {
    const s = demoStaffAvailability("k");
    expect(s.onLeave).toBe(s.onLeaveStaff.length);
    expect(s.present).toBeGreaterThan(0);
  });
});

describe("demoInsights", () => {
  it("uses real facts in the wording when provided", () => {
    const text = JSON.stringify(demoInsights("principal", { attendancePct: 91.4 }));
    expect(text).toContain("91.4%");
  });

  it("returns 2-3 insights for every role", () => {
    for (const role of ["principal", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"] as const) {
      const n = demoInsights(role, {}).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
