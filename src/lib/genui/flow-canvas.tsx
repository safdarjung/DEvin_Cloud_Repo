"use client";

import { useEffect, type CSSProperties } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type ColorMode,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Theme React Flow's own CSS vars from the app's design tokens (globals.css).
const THEME_STYLE: CSSProperties = {
  "--xy-node-background-color": "var(--color-card)",
  "--xy-node-border": "1px solid var(--color-border)",
  "--xy-node-color": "var(--color-foreground)",
  "--xy-edge-stroke": "var(--color-border)",
  "--xy-edge-stroke-selected": "var(--color-primary)",
  "--xy-connectionline-stroke": "var(--color-primary)",
  "--xy-minimap-background-color": "var(--color-card)",
  "--xy-minimap-mask-background-color": "var(--color-muted)",
  "--xy-controls-button-background-color": "var(--color-card)",
  "--xy-controls-button-border-color": "var(--color-border)",
  "--xy-controls-button-color": "var(--color-foreground)",
  "--xy-background-pattern-dots-color": "var(--color-border)",
} as CSSProperties;

export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
  nodeTypes?: NodeTypes;
  height?: number;
  readOnly?: boolean;
  colorMode?: ColorMode;
}

export function FlowCanvas({
  nodes,
  edges,
  onNodeClick,
  nodeTypes,
  height = 480,
  readOnly = true,
  colorMode = "system",
}: FlowCanvasProps) {
  const [rfNodes, setNodes, onNodesChange] = useNodesState(nodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(edges);

  // Spec can change after mount (new AI turn); resync React Flow's internal state.
  useEffect(() => setNodes(nodes), [nodes, setNodes]);
  useEffect(() => setEdges(edges), [edges, setEdges]);

  return (
    <div style={{ height, ...THEME_STYLE }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll
        fitView
        colorMode={colorMode}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export default FlowCanvas;
