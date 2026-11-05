import { describe, expect, it } from "vitest";
import { demoFixturesEnabled, demoInsights } from "@/modules/core/demo/fixtures";

describe("demoFixturesEnabled", () => {
  it("is false for a non-demo institution and true for a demo one", () => {
    const ctx = (is_demo: boolean) => ({ institution: { is_demo } }) as Parameters<typeof demoFixturesEnabled>[0];
    expect(demoFixturesEnabled(ctx(false))).toBe(false);
    expect(demoFixturesEnabled(ctx(true))).toBe(true);
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
