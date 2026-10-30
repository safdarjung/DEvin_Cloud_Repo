// D31/GU-04 — pure mindmap layout math.
import { describe, expect, it } from "vitest";
import { buildTree, radialPositions } from "@/modules/ai/blocks/mindmap-layout";
import type { MindmapNode } from "@/modules/ai/blocks/schemas";

function node(id: string, parentId: string | null, label = id): MindmapNode {
  return { id, parentId, label };
}

describe("buildTree", () => {
  it("positions leaves at distinct, non-overlapping x slots in depth-first order", () => {
    const nodes = [node("root", null), node("a", "root"), node("b", "root"), node("c", "root")];
    const tree = buildTree(nodes);
    const leafXs = ["a", "b", "c"].map((id) => tree.nodes.get(id)?.x);
    expect(new Set(leafXs).size).toBe(3);
    expect(leafXs.every((x) => typeof x === "number")).toBe(true);
  });

  it("positions a parent at the midpoint of its children", () => {
    const nodes = [node("root", null), node("a", "root"), node("b", "root")];
    const tree = buildTree(nodes);
    const a = tree.nodes.get("a")!;
    const b = tree.nodes.get("b")!;
    const root = tree.nodes.get("root")!;
    expect(root.x).toBeCloseTo((a.x + b.x) / 2);
  });

  it("drops a node whose parentId doesn't match any node in the block", () => {
    const nodes = [node("root", null), node("orphan", "does-not-exist")];
    const tree = buildTree(nodes);
    expect(tree.droppedIds).toEqual(["orphan"]);
    expect(tree.nodes.has("orphan")).toBe(false);
    expect(tree.rootIds).toEqual(["root"]);
  });

  it("assigns increasing y by depth", () => {
    const nodes = [node("root", null), node("a", "root"), node("aa", "a")];
    const tree = buildTree(nodes);
    expect(tree.nodes.get("root")!.y).toBeLessThan(tree.nodes.get("a")!.y);
    expect(tree.nodes.get("a")!.y).toBeLessThan(tree.nodes.get("aa")!.y);
  });

  it("handles a 60-node fixture without throwing and keeps every leaf distinct", () => {
    const nodes: MindmapNode[] = [node("root", null)];
    for (let i = 0; i < 59; i++) nodes.push(node(`n${i}`, "root"));
    const tree = buildTree(nodes);
    const leafXs = nodes.slice(1).map((n) => tree.nodes.get(n.id)?.x);
    expect(new Set(leafXs).size).toBe(59);
  });
});

describe("radialPositions", () => {
  it("places the root at the center", () => {
    const tree = buildTree([node("root", null), node("a", "root")]);
    const positions = radialPositions(tree);
    expect(positions.get("root")).toEqual({ x: 0, y: 0 });
  });

  it("places deeper nodes farther from the center than shallower ones", () => {
    const tree = buildTree([node("root", null), node("a", "root"), node("aa", "a")]);
    const positions = radialPositions(tree);
    const radius = (id: string) => Math.hypot(positions.get(id)!.x, positions.get(id)!.y);
    expect(radius("a")).toBeLessThan(radius("aa"));
  });
});
