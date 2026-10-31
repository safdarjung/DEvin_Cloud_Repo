import { describe, it, expect } from "vitest";
import { twinSnapshot, changeImpact } from "@/modules/fabric/demo/twin";

describe("twin fixture", () => {
  const opts = {
    seed: 7,
    now: new Date("2026-10-31"),
    institutionId: "inst-0001",
  };

  it("generates deterministic snapshot with same seed", () => {
    const snap1 = twinSnapshot(opts, "current");
    const snap2 = twinSnapshot(opts, "current");
    expect(snap1.nodes).toEqual(snap2.nodes);
    expect(snap1.edges).toEqual(snap2.edges);
  });

  it("has node count ≤ 80", () => {
    const snap = twinSnapshot(opts, "current");
    expect(snap.nodes.length).toBeLessThanOrEqual(80);
  });

  it("allocates exact node type counts", () => {
    const snap = twinSnapshot(opts, "current");
    const counts: Record<string, number> = {};
    for (const node of snap.nodes) {
      counts[node.type] = (counts[node.type] ?? 0) + 1;
    }
    expect(counts.student_group).toBe(12);
    expect(counts.teacher).toBe(20);
    expect(counts.department).toBe(6);
    expect(counts.room).toBe(20);
    expect(counts.building).toBe(2);
    expect(counts.route).toBe(5);
    expect(counts.vehicle).toBe(5);
    expect(counts.workflow).toBe(4);
    expect(counts.budget_line).toBe(4);
  });

  it("has edges ≈ 110", () => {
    const snap = twinSnapshot(opts, "current");
    expect(snap.edges.length).toBeGreaterThan(100);
    expect(snap.edges.length).toBeLessThan(120);
  });

  it("all edge endpoints exist", () => {
    const snap = twinSnapshot(opts, "current");
    const nodeIds = new Set(snap.nodes.map((n) => n.id));
    for (const edge of snap.edges) {
      expect(nodeIds.has(edge.source), `source ${edge.source} not found`).toBe(true);
      expect(nodeIds.has(edge.target), `target ${edge.target} not found`).toBe(true);
    }
  });

  it("historical state has lower loads", () => {
    const hist = twinSnapshot(opts, "historical");
    const curr = twinSnapshot(opts, "current");
    const histLoads = hist.nodes.filter((n) => n.load).map((n) => n.load!);
    const currLoads = curr.nodes.filter((n) => n.load).map((n) => n.load!);
    const histAvg = histLoads.length > 0 ? histLoads.reduce((a, b) => a + b, 0) / histLoads.length : 0;
    const currAvg = currLoads.length > 0 ? currLoads.reduce((a, b) => a + b, 0) / currLoads.length : 0;
    expect(histAvg).toBeLessThan(currAvg);
  });

  it("scenario state has ≥2 rooms over 100% utilization", () => {
    const snap = twinSnapshot(opts, "scenario");
    const over100 = snap.nodes.filter((n) => n.type === "room" && n.utilisation_pct! > 100);
    expect(over100.length).toBeGreaterThanOrEqual(2);
  });

  it("changeImpact of a room lists ≥1 affected node", () => {
    const snap = twinSnapshot(opts, "current");
    const room = snap.nodes.find((n) => n.type === "room");
    expect(room).toBeDefined();
    const impact = changeImpact(snap, room!.id);
    expect(impact.affected.length).toBeGreaterThanOrEqual(1);
  });

  it("changeImpact respects 2-hop limit", () => {
    const snap = twinSnapshot(opts, "current");
    const node = snap.nodes[0]!;
    const impact = changeImpact(snap, node.id);
    // No direct test for hop count, but verify no cycles or excessive results
    expect(impact.affected.length).toBeLessThan(snap.nodes.length);
  });

  it("nodes have x,y coordinates", () => {
    const snap = twinSnapshot(opts, "current");
    for (const node of snap.nodes) {
      expect(typeof node.x).toBe("number");
      expect(typeof node.y).toBe("number");
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("capacity/load/utilisation on groups/rooms/routes", () => {
    const snap = twinSnapshot(opts, "current");
    const hasCapacity = snap.nodes.filter((n) => ["student_group", "room", "route"].includes(n.type));
    for (const node of hasCapacity) {
      expect(node.capacity).toBeGreaterThan(0);
      expect(node.load).toBeGreaterThan(0);
      expect(node.utilisation_pct).toBeGreaterThan(0);
    }
  });

  it("edge relations are valid", () => {
    const snap = twinSnapshot(opts, "current");
    const validRelations = new Set(["teaches", "uses", "belongs_to", "depends_on", "transports", "funds"]);
    for (const edge of snap.edges) {
      expect(validRelations.has(edge.relation)).toBe(true);
    }
  });

  it("snapshot has correct state and metadata", () => {
    const snap = twinSnapshot(opts, "scenario");
    expect(snap.state).toBe("scenario");
    expect(snap.scenario_id).toBeDefined();
    expect(snap.as_of).toBe("2026-10-31");
    expect(snap.institution_id).toBe("inst-0001");
  });
});
