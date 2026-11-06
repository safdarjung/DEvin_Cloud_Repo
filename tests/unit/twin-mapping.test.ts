// F-UI-09 — src/modules/fabric/twin.mapping.ts's pure builder (real-data
// replacement for demo/twin.ts's fixture, tested separately by
// tests/unit/fabric-fixtures/twin.test.ts, which this file doesn't touch).
import { describe, expect, it } from "vitest";
import { buildTwinSnapshot, utilisationTier } from "@/modules/fabric/twin.mapping";

const BASE = { id: "snap-1", institutionId: "inst-1", asOf: "2026-11-06T00:00:00.000Z", state: "current" as const };

describe("utilisationTier", () => {
  it("ok at and below 80", () => {
    expect(utilisationTier(0)).toBe("ok");
    expect(utilisationTier(80)).toBe("ok");
  });
  it("watch between 81 and 100", () => {
    expect(utilisationTier(81)).toBe("watch");
    expect(utilisationTier(100)).toBe("watch");
  });
  it("critical above 100", () => {
    expect(utilisationTier(101)).toBe("critical");
  });
});

describe("buildTwinSnapshot", () => {
  it("falls back to enrolled count as capacity when section.capacity is null", () => {
    const snap = buildTwinSnapshot({
      ...BASE,
      sections: [{ id: "sec-1", label: "5-A", capacity: null, enrolled: 32 }],
      rooms: [],
      teachers: [],
      routes: [],
      slots: [],
      routeAssignments: [],
    });
    const node = snap.nodes.find((n) => n.id === "sec-1")!;
    expect(node.capacity).toBe(32);
    expect(node.load).toBe(32);
    expect(node.utilisation_pct).toBe(100);
  });

  it("computes utilisation from explicit capacity", () => {
    const snap = buildTwinSnapshot({
      ...BASE,
      sections: [],
      rooms: [{ id: "room-1", name: "Room 1", periodsTotal: 36, periodsUsed: 30 }],
      teachers: [],
      routes: [],
      slots: [],
      routeAssignments: [],
    });
    const node = snap.nodes.find((n) => n.id === "room-1")!;
    expect(node.utilisation_pct).toBe(83); // 30/36 rounded
  });

  it("builds teaches/uses/transports edges and drops ones with a missing endpoint", () => {
    const snap = buildTwinSnapshot({
      ...BASE,
      sections: [{ id: "sec-1", label: "5-A", capacity: 40, enrolled: 30 }],
      rooms: [{ id: "room-1", name: "Room 1", periodsTotal: 36, periodsUsed: 10 }],
      teachers: [{ id: "t-1", name: "Teacher 1", periodsWeek: 20, maxPeriods: 36 }],
      routes: [{ id: "route-1", name: "Route 1", capacity: 40, assigned: 20 }],
      slots: [
        { teacherId: "t-1", sectionId: "sec-1", roomId: "room-1" },
        { teacherId: "t-1", sectionId: "sec-1", roomId: "room-1" }, // duplicate slot -> deduped edge
        { teacherId: "t-missing", sectionId: "sec-1", roomId: null }, // dangling source -> dropped
      ],
      routeAssignments: [
        { routeId: "route-1", sectionId: "sec-1" },
        { routeId: "route-missing", sectionId: "sec-1" }, // dangling source -> dropped
      ],
    });

    expect(snap.edges).toEqual(
      expect.arrayContaining([
        { source: "t-1", target: "sec-1", relation: "teaches" },
        { source: "sec-1", target: "room-1", relation: "uses" },
        { source: "route-1", target: "sec-1", relation: "transports" },
      ]),
    );
    expect(snap.edges).toHaveLength(3);
  });

  it("every edge endpoint exists among the built nodes", () => {
    const snap = buildTwinSnapshot({
      ...BASE,
      sections: [{ id: "sec-1", label: "5-A", capacity: 40, enrolled: 30 }],
      rooms: [{ id: "room-1", name: "Room 1", periodsTotal: 36, periodsUsed: 10 }],
      teachers: [{ id: "t-1", name: "Teacher 1", periodsWeek: 20, maxPeriods: 36 }],
      routes: [],
      slots: [{ teacherId: "t-1", sectionId: "sec-1", roomId: "room-1" }],
      routeAssignments: [],
    });
    const nodeIds = new Set(snap.nodes.map((n) => n.id));
    for (const edge of snap.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("stamps state, as_of and null scenario_id", () => {
    const snap = buildTwinSnapshot({ ...BASE, sections: [], rooms: [], teachers: [], routes: [], slots: [], routeAssignments: [] });
    expect(snap.state).toBe("current");
    expect(snap.as_of).toBe(BASE.asOf);
    expect(snap.scenario_id).toBeNull();
  });
});
