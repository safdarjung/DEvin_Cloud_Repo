import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/lib/nav";
import { RunPracticeScenarioSchema } from "@/modules/core/practice/schemas";
import { PRACTICE_SCENARIOS, PRACTICE_SCENARIO_KEYS, practiceOptionsFor } from "@/modules/core/practice/scenarios";

const all = { isDemo: true, has: () => true, moduleOn: () => true };

describe("practice scenarios", () => {
  it("each belongs to a real sidebar tab, so its button can appear in the tour", () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    expect(PRACTICE_SCENARIO_KEYS.filter((k) => !hrefs.has(PRACTICE_SCENARIOS[k].tab))).toEqual([]);
  });

  it("are offered only in the demo school", () => {
    expect(practiceOptionsFor("/helpdesk", all).map((o) => o.key)).toEqual(["helpdesk.urgent", "helpdesk.mixed"]);
    expect(practiceOptionsFor("/helpdesk", { ...all, isDemo: false })).toEqual([]);
  });

  it("are hidden without the permission or with the module off", () => {
    expect(practiceOptionsFor("/health", { ...all, has: (p) => p !== "health.write" })).toEqual([]);
    expect(practiceOptionsFor("/visitors", { ...all, moduleOn: (m) => m !== "visitors" })).toEqual([]);
  });

  it("rejects a scenario name that does not exist", () => {
    expect(RunPracticeScenarioSchema.safeParse({ scenario: "finance.delete-everything" }).success).toBe(false);
    expect(RunPracticeScenarioSchema.safeParse({ scenario: "health.minor" }).success).toBe(true);
  });
});
