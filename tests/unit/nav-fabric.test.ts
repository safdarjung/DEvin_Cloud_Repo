import { describe, it, expect } from "vitest";
import { NAV_ITEMS, navItemsFor } from "@/lib/nav";

describe("Fabric navigation", () => {
  it("includes all 13 fabric and personal hrefs for dashboard.view + ai.generate", () => {
    const principal = new Set([
      "dashboard.view",
      "ai.generate",
      "student.read",
      "exam.result.read",
    ] as const);

    const items = navItemsFor(principal);
    const fabricAndPersonalItems = items.filter(
      (item) => item.group === "Fabric" || item.group === "Personal"
    );

    const fabricHrefs = [
      "/fabric/learning",
      "/fabric/students",
      "/fabric/operations",
      "/fabric/finance-intel",
      "/fabric/insights",
      "/fabric/simulator",
      "/fabric/twin",
      "/fabric/agents",
      "/fabric/marketplace",
      "/fabric/studio",
      "/fabric/data",
      "/fabric/trust",
    ];

    const personalHrefs = ["/me"];

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

  it("all fabric items have dashboard.view permission", () => {
    const fabricItems = NAV_ITEMS.filter((item) => item.group === "Fabric");

    fabricItems.forEach((item) => {
      expect(item.permission).toBe("dashboard.view");
    });
  });

  it("personal item has ai.generate permission", () => {
    const personalItem = NAV_ITEMS.find((item) => item.group === "Personal");

    expect(personalItem).toBeDefined();
    expect(personalItem?.href).toBe("/me");
    expect(personalItem?.permission).toBe("ai.generate");
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
