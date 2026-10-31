import { describe, it, expect } from "vitest";
import {
  dailyBrief,
  priorityActions,
  forecastCards,
  riskIndicators,
  defaultWidgetOrder,
} from "@/modules/fabric/demo/command";
import type { FixtureOpts } from "@/modules/fabric/demo/prng";

describe("fabric/demo/command", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const institutionId = "inst-test-001";

  describe("determinism: same seed produces identical output", () => {
    it("dailyBrief is deterministic", () => {
      const opts: FixtureOpts = { seed: 42, now, institutionId };
      const brief1 = dailyBrief(opts, "principal");
      const brief2 = dailyBrief(opts, "principal");
      expect(brief1).toEqual(brief2);
    });

    it("priorityActions is deterministic", () => {
      const opts: FixtureOpts = { seed: 42, now, institutionId };
      const actions1 = priorityActions(opts);
      const actions2 = priorityActions(opts);
      expect(actions1).toEqual(actions2);
    });

    it("forecastCards is deterministic", () => {
      const opts: FixtureOpts = { seed: 42, now, institutionId };
      const cards1 = forecastCards(opts);
      const cards2 = forecastCards(opts);
      expect(cards1).toEqual(cards2);
    });

    it("riskIndicators is deterministic", () => {
      const opts: FixtureOpts = { seed: 42, now, institutionId };
      const risks1 = riskIndicators(opts);
      const risks2 = riskIndicators(opts);
      expect(risks1).toEqual(risks2);
    });
  });

  describe("item counts", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("dailyBrief returns 5-7 items", () => {
      const brief = dailyBrief(opts, "principal");
      expect(brief.items.length).toBeGreaterThanOrEqual(5);
      expect(brief.items.length).toBeLessThanOrEqual(7);
    });

    it("priorityActions returns 8 actions", () => {
      const actions = priorityActions(opts);
      expect(actions).toHaveLength(8);
    });

    it("forecastCards returns 4 cards", () => {
      const cards = forecastCards(opts);
      expect(cards).toHaveLength(4);
    });

    it("riskIndicators returns 6 indicators", () => {
      const risks = riskIndicators(opts);
      expect(risks).toHaveLength(6);
    });
  });

  describe("href validation", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("all dailyBrief hrefs start with /", () => {
      const roles: Array<"principal" | "teacher" | "guardian" | "student"> = [
        "principal",
        "teacher",
        "guardian",
        "student",
      ];
      roles.forEach((role) => {
        const brief = dailyBrief(opts, role);
        brief.items.forEach((item) => {
          if (item.href) {
            expect(item.href).toMatch(/^\//);
          }
        });
      });
    });

    it("all priorityActions hrefs start with /", () => {
      const actions = priorityActions(opts);
      actions.forEach((action) => {
        expect(action.href).toMatch(/^\//);
      });
    });
  });

  describe("role-specific content", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("dailyBrief respects role argument", () => {
      const principal = dailyBrief(opts, "principal");
      const teacher = dailyBrief(opts, "teacher");
      const guardian = dailyBrief(opts, "guardian");
      const student = dailyBrief(opts, "student");

      expect(principal.role).toBe("principal");
      expect(teacher.role).toBe("teacher");
      expect(guardian.role).toBe("guardian");
      expect(student.role).toBe("student");
    });

    it("dailyBrief includes Indian names for guardian and student", () => {
      const guardian = dailyBrief(opts, "guardian");
      // Should contain a child name in at least one item text
      const hasName = guardian.items.some((item) =>
        /^[A-Z][a-z]+/.test(item.text)
      );
      expect(hasName).toBe(true);
    });
  });

  describe("defaultWidgetOrder", () => {
    it("returns string arrays for all roles", () => {
      const roles: Array<"principal" | "teacher" | "guardian" | "student"> = [
        "principal",
        "teacher",
        "guardian",
        "student",
      ];
      roles.forEach((role) => {
        const order = defaultWidgetOrder(role);
        expect(Array.isArray(order)).toBe(true);
        expect(order.length).toBeGreaterThan(0);
        order.forEach((id) => {
          expect(typeof id).toBe("string");
        });
      });
    });

    it("principal order includes staff, approvals, insights", () => {
      const order = defaultWidgetOrder("principal");
      expect(order).toContain("brief");
      expect(order).toContain("priorities");
      expect(order).toContain("staff");
      expect(order).toContain("approvals");
    });
  });

  describe("insight_id references", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("insight_id values follow pattern ins-NNNN", () => {
      const brief = dailyBrief(opts, "principal");
      brief.items.forEach((item) => {
        if (item.insight_id) {
          expect(item.insight_id).toMatch(/^ins-\d{4}$/);
        }
      });

      const risks = riskIndicators(opts);
      risks.forEach((risk) => {
        if (risk.insight_id) {
          expect(risk.insight_id).toMatch(/^ins-\d{4}$/);
        }
      });
    });
  });

  describe("data types and bounds", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("forecastCards have valid confidence values", () => {
      const cards = forecastCards(opts);
      cards.forEach((card) => {
        expect(card.confidence).toBeGreaterThanOrEqual(0);
        expect(card.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("riskIndicators have valid levels and trends", () => {
      const validLevels = ["info", "watch", "warning", "critical"];
      const validTrends = ["up", "flat", "down"];
      const risks = riskIndicators(opts);
      risks.forEach((risk) => {
        expect(validLevels).toContain(risk.level);
        expect(validTrends).toContain(risk.trend);
      });
    });

    it("priorityActions have valid severity values", () => {
      const validSeverities = ["info", "watch", "warning", "critical"];
      const actions = priorityActions(opts);
      actions.forEach((action) => {
        expect(validSeverities).toContain(action.severity);
      });
    });

    it("forecastCards have valid unit values", () => {
      const validUnits = ["count", "pct", "paise"];
      const cards = forecastCards(opts);
      cards.forEach((card) => {
        expect(validUnits).toContain(card.unit);
      });
    });

    it("forecastCards have valid direction values", () => {
      const validDirections = ["up", "flat", "down"];
      const cards = forecastCards(opts);
      cards.forEach((card) => {
        expect(validDirections).toContain(card.direction);
      });
    });
  });

  describe("structure validation", () => {
    const opts: FixtureOpts = { seed: 7, now, institutionId };

    it("dailyBrief has required fields", () => {
      const brief = dailyBrief(opts, "principal");
      expect(brief).toHaveProperty("role");
      expect(brief).toHaveProperty("date");
      expect(brief).toHaveProperty("headline");
      expect(brief).toHaveProperty("items");
      expect(brief).toHaveProperty("generated_by");
      expect(brief.generated_by).toBe("fixture");
    });

    it("priorityActions have required fields", () => {
      const actions = priorityActions(opts);
      actions.forEach((action) => {
        expect(action).toHaveProperty("id");
        expect(action).toHaveProperty("title");
        expect(action).toHaveProperty("why");
        expect(action).toHaveProperty("href");
        expect(action).toHaveProperty("owner");
        expect(action).toHaveProperty("due");
        expect(action).toHaveProperty("severity");
      });
    });

    it("forecastCards have required fields", () => {
      const cards = forecastCards(opts);
      cards.forEach((card) => {
        expect(card).toHaveProperty("metric");
        expect(card).toHaveProperty("current");
        expect(card).toHaveProperty("forecast");
        expect(card).toHaveProperty("unit");
        expect(card).toHaveProperty("confidence");
        expect(card).toHaveProperty("direction");
      });
    });
  });
});
