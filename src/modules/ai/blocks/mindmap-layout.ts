// D31/GU-04 — pure layout math for `MindmapBlockView`. No DOM, no React,
// so it's unit-testable without a browser (tests/unit/mindmap-layout.test.ts).
import type { MindmapNode } from "@/modules/ai/blocks/schemas";

export interface PositionedNode extends MindmapNode {
  x: number;
  y: number;
  depth: number;
  childIds: string[];
}

export interface TreeLayout {
  nodes: Map<string, PositionedNode>;
  rootIds: string[];
  /** Nodes whose `parentId` didn't resolve to another node in the block — excluded from the tree entirely. */
  droppedIds: string[];
}

const SPACING_X = 120;
const SPACING_Y = 90;

/**
 * Builds parent→children links and positions every node: leaves get
 * sequential x-slots in depth-first order, a parent's x is the midpoint of
 * its children's x, y is `depth * SPACING_Y`. A node whose `parentId`
 * doesn't match any node in the block is dropped (plan §4: schema
 * tolerates it, this is where it's actually excluded).
 */
export function buildTree(nodes: readonly MindmapNode[]): TreeLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const droppedIds: string[] = [];
  const childIds = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const node of nodes) {
    if (node.parentId === null) {
      rootIds.push(node.id);
      continue;
    }
    if (!byId.has(node.parentId)) {
      droppedIds.push(node.id);
      continue;
    }
    const siblings = childIds.get(node.parentId) ?? [];
    siblings.push(node.id);
    childIds.set(node.parentId, siblings);
  }

  const positioned = new Map<string, PositionedNode>();
  let nextLeafSlot = 0;

  // Depth-first: assigns every leaf the next integer slot, then each
  // parent's x is the mean of its children's x (post-order, so children
  // are positioned before the parent that depends on them).
  function visit(id: string, depth: number): number {
    const node = byId.get(id);
    if (!node) return 0;
    const children = childIds.get(id) ?? [];
    let x: number;
    if (children.length === 0) {
      x = nextLeafSlot;
      nextLeafSlot += 1;
    } else {
      const childXs = children.map((childId) => visit(childId, depth + 1));
      x = childXs.reduce((sum, v) => sum + v, 0) / childXs.length;
    }
    positioned.set(id, { ...node, x: x * SPACING_X, y: depth * SPACING_Y, depth, childIds: children });
    return x;
  }

  for (const rootId of rootIds) visit(rootId, 0);

  return { nodes: positioned, rootIds, droppedIds };
}

export interface RadialPosition {
  x: number;
  y: number;
}

const RADIUS_STEP = 100;

/**
 * Same tree (depth, leaf order) as `buildTree`, remapped to polar
 * coordinates: angle from the leaf's sequential slot, radius from depth.
 * Centered at (0, 0) — the caller translates into its own viewBox.
 */
export function radialPositions(tree: TreeLayout): Map<string, RadialPosition> {
  const leaves = [...tree.nodes.values()].filter((node) => node.childIds.length === 0);
  const leafCount = Math.max(leaves.length, 1);
  const positions = new Map<string, RadialPosition>();

  for (const node of tree.nodes.values()) {
    if (node.depth === 0) {
      positions.set(node.id, { x: 0, y: 0 });
      continue;
    }
    const angle = (node.x / SPACING_X / leafCount) * 2 * Math.PI;
    const radius = node.depth * RADIUS_STEP;
    positions.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }

  return positions;
}
