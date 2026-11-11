// Human text for workflow schedules/triggers and the schedule picker <-> cron mapping (pure).
import { describe, expect, test } from "vitest";
import { cronFromPick, describeCron, describeTrigger, pickFromCron } from "../../src/modules/workflows/describe";

describe("describeCron", () => {
  test.each([
    ["0 10 * * 1-6", "Mon–Sat at 10:00"],
    ["30 7 * * 1-5", "Mon–Fri at 07:30"],
    ["0 16 * * *", "Every day at 16:00"],
    ["0 9 * * 1", "Every Monday at 09:00"],
    ["15 8 * * 1,3,5", "Mon, Wed, Fri at 08:15"],
    ["0 9 1 * *", "Day 1 of every month at 09:00"],
  ])("%s reads as %s", (cron, text) => {
    expect(describeCron(cron)).toBe(text);
  });

  test("a cron it cannot phrase stays visible as a custom schedule", () => {
    expect(describeCron("0 9,15 * * *")).toBe("Custom schedule (0 9,15 * * *)");
    expect(describeCron("not a cron")).toBe("Custom schedule (not a cron)");
  });
});

describe("schedule picker", () => {
  test("daily / Mon–Fri / Mon–Sat / weekly write the cron", () => {
    expect(cronFromPick({ frequency: "daily", day: 1, time: "16:00" })).toBe("0 16 * * *");
    expect(cronFromPick({ frequency: "mon_fri", day: 1, time: "07:30" })).toBe("30 7 * * 1-5");
    expect(cronFromPick({ frequency: "mon_sat", day: 1, time: "10:00" })).toBe("0 10 * * 1-6");
    expect(cronFromPick({ frequency: "weekly", day: 5, time: "09:05" })).toBe("5 9 * * 5");
  });

  test("round trips, and a cron outside the picker returns null", () => {
    for (const cron of ["0 16 * * *", "30 7 * * 1-5", "0 10 * * 1-6", "5 9 * * 5"]) {
      const pick = pickFromCron(cron);
      expect(pick).not.toBeNull();
      expect(cronFromPick(pick!)).toBe(cron);
    }
    expect(pickFromCron("0 9 1 * *")).toBeNull();
    expect(pickFromCron("0 9,15 * * *")).toBeNull();
  });
});

describe("describeTrigger", () => {
  test("humanises every trigger kind", () => {
    expect(describeTrigger("manual", "")).toBe("By hand");
    expect(describeTrigger("schedule", "0 10 * * 1-6")).toBe("Mon–Sat at 10:00");
    expect(describeTrigger("event", "attendance.absences_submitted")).toBe("When a class's absences are submitted");
    expect(describeTrigger("event", "results.published")).toBe("When exam results are published");
  });
});
