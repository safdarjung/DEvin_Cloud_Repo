import { describe, it, expect } from "vitest";
import { studentSuccessRows, interventionPlans } from "@/modules/fabric/demo/success";

const now = new Date("2026-10-31");
const opts = { seed: 7, now, institutionId: "inst-001" };

describe("fabric fixtures: success", () => {
  it("studentSuccessRows generates 60 students", () => {
    const rows = studentSuccessRows(opts);
    expect(rows).toHaveLength(60);
  });

  it("studentSuccessRows deterministic seed produces same output", () => {
    const rows1 = studentSuccessRows(opts);
    const rows2 = studentSuccessRows(opts);
    expect(rows1).toEqual(rows2);
  });

  it("studentSuccessRows risk distribution ~70% none, ~20% watch, ~10% support", () => {
    const rows = studentSuccessRows(opts);
    const none = rows.filter((r) => r.risk === "none").length;
    const watch = rows.filter((r) => r.risk === "watch").length;
    const support = rows.filter((r) => r.risk === "support").length;

    // 70%: 42, 20%: 12, 10%: 6
    expect(none).toBeGreaterThanOrEqual(38);
    expect(none).toBeLessThanOrEqual(46);
    expect(watch).toBeGreaterThanOrEqual(8);
    expect(watch).toBeLessThanOrEqual(16);
    expect(support).toBeGreaterThanOrEqual(4);
    expect(support).toBeLessThanOrEqual(10);
  });

  it("studentSuccessRows none-risk students have no gaps and no support_owner", () => {
    const rows = studentSuccessRows(opts);
    const none = rows.filter((r) => r.risk === "none");
    none.forEach((s) => {
      expect(s.gaps).toHaveLength(0);
      expect(s.support_owner).toBeNull();
      expect(s.last_contact).toBeNull();
    });
  });

  it("studentSuccessRows support-risk students have 1-3 gaps and support_owner", () => {
    const rows = studentSuccessRows(opts);
    const support = rows.filter((r) => r.risk === "support");
    support.forEach((s) => {
      expect(s.gaps.length).toBeGreaterThanOrEqual(1);
      expect(s.gaps.length).toBeLessThanOrEqual(3);
      expect(s.support_owner).not.toBeNull();
    });
  });

  it("interventionPlans generates up to 8 plans (one per support-risk student)", () => {
    const plans = interventionPlans(opts);
    expect(plans.length).toBeLessThanOrEqual(8);
    expect(plans.length).toBeGreaterThan(0);
  });

  it("interventionPlans deterministic seed produces same output", () => {
    const plans1 = interventionPlans(opts);
    const plans2 = interventionPlans(opts);
    expect(plans1).toEqual(plans2);
  });

  it("interventionPlans every plan has 3-4 steps", () => {
    const plans = interventionPlans(opts);
    plans.forEach((p) => {
      expect(p.steps.length).toBeGreaterThanOrEqual(3);
      expect(p.steps.length).toBeLessThanOrEqual(4);
    });
  });

  it("interventionPlans all restricted=true", () => {
    const plans = interventionPlans(opts);
    plans.forEach((p) => {
      expect(p.restricted).toBe(true);
    });
  });

  it("interventionPlans all student_ids exist in studentSuccessRows", () => {
    const rows = studentSuccessRows(opts);
    const plans = interventionPlans(opts);
    const studentIds = new Set(rows.map((r) => r.student_id));

    plans.forEach((p) => {
      expect(studentIds.has(p.student_id)).toBe(true);
    });
  });

  it("interventionPlans all student_ids are support-risk students", () => {
    const rows = studentSuccessRows(opts);
    const plans = interventionPlans(opts);
    const supportStudents = new Set(
      rows.filter((r) => r.risk === "support").map((r) => r.student_id)
    );

    plans.forEach((p) => {
      expect(supportStudents.has(p.student_id)).toBe(true);
    });
  });

  it("interventionPlans owner matches student support_owner", () => {
    const rows = studentSuccessRows(opts);
    const plans = interventionPlans(opts);
    const studentMap = new Map(rows.map((r) => [r.student_id, r]));

    plans.forEach((p) => {
      const student = studentMap.get(p.student_id);
      expect(student).toBeDefined();
      expect(student?.support_owner).toBe(p.owner);
    });
  });
});
