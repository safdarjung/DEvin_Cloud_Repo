import type { Edge, Node } from "@xyflow/react";

export interface FlowSpecNode {
  id: string;
  label: string;
  type?: string;
  x?: number;
  y?: number;
}

export interface FlowSpecEdge {
  source: string;
  target: string;
  label?: string;
}

export interface FlowSpec {
  nodes: FlowSpecNode[];
  edges: FlowSpecEdge[];
}

const COLUMN_GAP_PX = 220;
const ROW_GAP_PX = 90;

/** Maps a GenUI flow spec to React Flow nodes/edges. Nodes missing x/y get a
 * deterministic column (BFS depth from source nodes) and row (input order
 * within that column); explicit x/y is preserved as-is. */
export function flowFromSpec(spec: FlowSpec): { nodes: Node[]; edges: Edge[] } {
  const depthById = computeDepths(spec.nodes, spec.edges);
  const nextRowByDepth = new Map<number, number>();

  const nodes: Node[] = spec.nodes.map((n) => {
    const hasExplicitPosition = typeof n.x === "number" && typeof n.y === "number";
    const position = hasExplicitPosition
      ? { x: n.x as number, y: n.y as number }
      : nextLayoutPosition(depthById.get(n.id) ?? 0, nextRowByDepth);

    return {
      id: n.id,
      type: n.type,
      position,
      data: { label: n.label },
    };
  });

  const edges: Edge[] = spec.edges.map((e, i) => ({
    id: `${e.source}->${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
  }));

  return { nodes, edges };
}

function nextLayoutPosition(depth: number, nextRowByDepth: Map<number, number>) {
  const row = nextRowByDepth.get(depth) ?? 0;
  nextRowByDepth.set(depth, row + 1);
  return { x: depth * COLUMN_GAP_PX, y: row * ROW_GAP_PX };
}

/** Longest-path layering via Kahn's algorithm: depth 0 = nodes with no
 * incoming edge, each successor gets max(predecessor depth) + 1. Nodes left
 * over by a cycle (never reach in-degree 0) get appended in input order
 * after the deepest resolved column, so layout stays deterministic. */
function computeDepths(nodes: FlowSpecNode[], edges: FlowSpecEdge[]): Map<string, number> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (e.source === e.target) continue; // self-loop: no cross-depth dependency
    adjacency.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const depth = new Map<string, number>();
  const remainingInDegree = new Map(inDegree);
  const queue: string[] = ids.filter((id) => inDegree.get(id) === 0);
  queue.forEach((id) => depth.set(id, 0));

  let i = 0;
  while (i < queue.length) {
    const id = queue[i++];
    const d = depth.get(id) ?? 0;
    for (const next of adjacency.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, d + 1));
      const remaining = (remainingInDegree.get(next) ?? 0) - 1;
      remainingInDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  let maxDepth = 0;
  depth.forEach((d) => {
    if (d > maxDepth) maxDepth = d;
  });
  for (const id of ids) {
    if (!depth.has(id)) {
      maxDepth += 1;
      depth.set(id, maxDepth);
    }
  }

  return depth;
}
