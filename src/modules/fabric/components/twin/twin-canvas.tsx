"use client";
// F-UI-09 — read-only React Flow view of a TwinSnapshot, built on the
// existing @/lib/genui/flow-canvas FlowCanvas (reused, not re-implemented).
// Keyed by `state` by the caller so a snapshot swap remounts (and re-fits)
// rather than animating stale positions.
import dynamic from "next/dynamic";
import type { Edge, Node } from "@xyflow/react";
import { FadeIn } from "@/components/motion";
import type { InsightSeverity, TwinEdge, TwinNode, TwinNodeType } from "@/modules/fabric/types";
import { twinNodeTypes, type TwinNodeData } from "./nodes";

const FlowCanvas = dynamic(() => import("@/lib/genui/flow-canvas"), {
  ssr: false,
  loading: () => <div className="h-[480px] animate-pulse rounded-xl border border-dashed" aria-hidden />,
});

function toFlowNode(n: TwinNode, impactSeverity: InsightSeverity | undefined): Node {
  const data: TwinNodeData = {
    label: n.label,
    nodeType: n.type,
    capacity: n.capacity,
    load: n.load,
    utilisation_pct: n.utilisation_pct,
    impactSeverity,
  };
  return { id: n.id, type: n.type, position: { x: n.x ?? 0, y: n.y ?? 0 }, data };
}

function toFlowEdge(e: TwinEdge, i: number): Edge {
  return { id: `${e.source}-${e.target}-${i}`, source: e.source, target: e.target, label: e.relation };
}

export function TwinCanvas({
  nodes,
  edges,
  hiddenTypes,
  impactById,
  onNodeClick,
}: {
  nodes: TwinNode[];
  edges: TwinEdge[];
  hiddenTypes: Set<TwinNodeType>;
  /** node id -> severity, while "Show impact" is active (entity-drawer.tsx). */
  impactById?: Map<string, InsightSeverity>;
  onNodeClick: (id: string) => void;
}) {
  const visible = nodes.filter((n) => !hiddenTypes.has(n.type));
  const visibleIds = new Set(visible.map((n) => n.id));
  const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  return (
    <FadeIn>
      <FlowCanvas
        nodes={visible.map((n) => toFlowNode(n, impactById?.get(n.id)))}
        edges={visibleEdges.map(toFlowEdge)}
        nodeTypes={twinNodeTypes}
        height={480}
        readOnly
        onNodeClick={(_event, node) => onNodeClick(node.id)}
      />
      {/* Keyboard/screen-reader mirror of the canvas (packet a11y): same click handler, no pan/zoom needed to reach a node. */}
      <ul className="sr-only">
        {visible.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onNodeClick(n.id)}>
              {n.label}
            </button>
          </li>
        ))}
      </ul>
    </FadeIn>
  );
}
