import { describe, it, expect } from "vitest";
import { NAV_ITEMS, navItemsFor } from "@/lib/nav";

const ENABLED = { modules: { insights: true, forecasts: true, agents: true } };
// Live workspaces (2026-11-06), each gated by its page's own permission.
const OWN_PERMISSION: Record<string, string> = {
  "/fabric/students": "mastery.review",
  "/fabric/simulator": "scenario.manage",
  "/fabric/studio": "studio.request",
};
const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

describe("Fabric navigation", () => {
  it("lists the live workspaces on non-demo tenants, each only with its own permission", () => {
    const viewer = hrefs(navItemsFor(new Set(["dashboard.view", "insight.read"] as const), ENABLED, false));
    expect(viewer).toEqual(expect.arrayContaining(["/fabric/twin", "/fabric/marketplace", "/fabric/insights"]));
    for (const h of Object.keys(OWN_PERMISSION)) expect(viewer).not.toContain(h);
    const leader = hrefs(
      navItemsFor(new Set(["dashboard.view", "mastery.review", "scenario.manage", "studio.request"] as const), { modules: { mastery: true } }, false),
    );
    for (const h of Object.keys(OWN_PERMISSION)) expect(leader).toContain(h);
  });

  it("hides module-gated fabric pages when the module is off or permission is missing", () => {
    const perms = new Set(["dashboard.view", "insight.read", "forecast.read", "agent.run"] as const);
    const off = hrefs(navItemsFor(perms, {}, true));
    for (const h of ["/fabric/insights", "/fabric/finance-intel", "/fabric/agents"]) expect(off).not.toContain(h);
    const admissions = hrefs(navItemsFor(new Set(["dashboard.view", "insight.read"] as const), ENABLED, true));
    expect(admissions).toContain("/fabric/insights");
    expect(admissions).not.toContain("/fabric/finance-intel");
    expect(admissions).not.toContain("/fabric/agents");
  });

  it("hides fabric links from staff without dashboard.view (teacher)", () => {
    const teacher = new Set(["insight.read", "forecast.read", "attendance.mark"] as const);
    expect(navItemsFor(teacher, ENABLED, true).filter((i) => i.group === "Fabric")).toHaveLength(0);
  });

  it("includes the non-demo fabric and personal hrefs for dashboard.view + ai.generate (+ finance.read for finance intel)", () => {
    const principal = new Set([
      "dashboard.view",
      "insight.read",
      "forecast.read",
      "agent.run",
      "ai.generate",
      "student.read",
      "exam.result.read",
      "finance.read",
    ] as const);

    const items = navItemsFor(principal, ENABLED, true);
    const fabricAndPersonalItems = items.filter(
      (item) => item.group === "Fabric" || item.group === "Personal"
    );

    const fabricHrefs = [
      // students / simulator / studio need their own permission (not held here).
      "/fabric/learning",
      "/fabric/operations",
      "/fabric/finance-intel",
      "/fabric/insights",
      "/fabric/twin",
      "/fabric/agents",
      "/fabric/marketplace",
      "/fabric/data",
      "/fabric/trust",
    ];

    // /me is a placeholder workspace, no longer linked (2026-11-06).
    const personalHrefs: string[] = [];

    const allExpected = [...fabricHrefs, ...personalHrefs];

    const actualHrefs = fabricAndPersonalItems.map((item) => item.href);
    expect(actualHrefs).toEqual(allExpected);
  });

  it("excludes fabric and personal items from guardian permissions", () => {
    // Guardians only have exam.recheck.request (portal users)
    const guardianPermissions = new Set(["exam.recheck.request"] as const);

    const items = navItemsFor(guardianPermissions);
    const fabricAndPersonal = items.filter(
      (item) => item.group === "Fabric" || item.group === "Personal"
    );

    expect(fabricAndPersonal).toHaveLength(0);
  });

  it("ungated fabric items have dashboard.view permission, except workspaces with their own", () => {
    const fabricItems = NAV_ITEMS.filter((item) => item.group === "Fabric" && !item.module);

    fabricItems.forEach((item) => {
      expect(item.permission).toBe(OWN_PERMISSION[item.href] ?? "dashboard.view");
    });
  });

  it("links no placeholder personal workspace", () => {
    expect(NAV_ITEMS.find((item) => item.group === "Personal")).toBeUndefined();
  });

  it("fabric items are contiguous in NAV_ITEMS", () => {
    const fabricIndices = NAV_ITEMS.map((item, i) =>
      item.group === "Fabric" ? i : -1
    ).filter((i) => i !== -1);

    if (fabricIndices.length > 0) {
      const minIndex = Math.min(...fabricIndices);
      const maxIndex = Math.max(...fabricIndices);
      const expectedCount = maxIndex - minIndex + 1;

      expect(fabricIndices.length).toBe(expectedCount);
    }
  });

  it("personal items are contiguous in NAV_ITEMS", () => {
    const personalIndices = NAV_ITEMS.map((item, i) =>
      item.group === "Personal" ? i : -1
    ).filter((i) => i !== -1);

    if (personalIndices.length > 0) {
      const minIndex = Math.min(...personalIndices);
      const maxIndex = Math.max(...personalIndices);
      const expectedCount = maxIndex - minIndex + 1;

      expect(personalIndices.length).toBe(expectedCount);
    }
  });
});
