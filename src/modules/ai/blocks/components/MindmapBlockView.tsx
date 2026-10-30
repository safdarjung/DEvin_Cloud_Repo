"use client";

// D31/GU-04. Hybrid rendering, not pure SVG: connector lines are SVG
// (cheap to draw), nodes are real `<button>` elements absolutely
// positioned over the SVG — real buttons get keyboard focus, click
// handling and screen-reader semantics for free; SVG `<text>` click
// targets don't.
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildTree, radialPositions, type PositionedNode } from "@/modules/ai/blocks/mindmap-layout";
import type { MindmapBlock } from "@/modules/ai/blocks/schemas";

const NODE_PADDING = 60;

interface MindmapBlockViewProps {
  block: MindmapBlock;
  /** D28/D31 pattern: optional, since no caller wires it yet (GU-08, wave 2) — omitted entirely when absent, never a disabled-looking dead button. */
  onExplainNode?: (node: { id: string; label: string; detail?: string }) => void;
}

function visibleIds(tree: ReturnType<typeof buildTree>, collapsed: Set<string>): Set<string> {
  const visible = new Set<string>();
  function visit(id: string) {
    visible.add(id);
    if (collapsed.has(id)) return;
    const node = tree.nodes.get(id);
    for (const childId of node?.childIds ?? []) visit(childId);
  }
  for (const rootId of tree.rootIds) visit(rootId);
  return visible;
}

function OutlineNode({
  tree,
  id,
  onExplainNode,
}: {
  tree: ReturnType<typeof buildTree>;
  id: string;
  onExplainNode?: MindmapBlockViewProps["onExplainNode"];
}) {
  const node = tree.nodes.get(id);
  if (!node) return null;
  const hasChildren = node.childIds.length > 0;
  const content = (
    <>
      <span>{node.label}</span>
      {node.detail && <p className="text-muted-foreground ml-2 text-sm">{node.detail}</p>}
      {onExplainNode && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onExplainNode(node)}>
          Explain
        </Button>
      )}
    </>
  );
  if (!hasChildren) return <li className="py-1">{content}</li>;
  return (
    <li>
      <details open>
        <summary className="cursor-pointer py-1">{content}</summary>
        <ul className="list-none pl-4">
          {node.childIds.map((childId) => (
            <OutlineNode key={childId} tree={tree} id={childId} onExplainNode={onExplainNode} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function MindmapBlockView({ block, onExplainNode }: MindmapBlockViewProps) {
  const tree = useMemo(() => buildTree(block.nodes), [block.nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"diagram" | "outline">(block.variant === "outline" ? "outline" : "diagram");
  const svgRef = useRef<SVGSVGElement>(null);

  const isRadial = block.variant === "radial";
  const positions = useMemo(() => {
    if (!isRadial) return new Map(tree.nodes.entries());
    const radial = radialPositions(tree);
    const merged = new Map<string, PositionedNode>();
    for (const [id, node] of tree.nodes) {
      const position = radial.get(id) ?? { x: 0, y: 0 };
      merged.set(id, { ...node, x: position.x, y: position.y });
    }
    return merged;
  }, [tree, isRadial]);

  const shown = visibleIds(tree, collapsed);
  const visibleNodes = [...positions.values()].filter((node) => shown.has(node.id));
  const minX = Math.min(0, ...visibleNodes.map((n) => n.x));
  const maxX = Math.max(0, ...visibleNodes.map((n) => n.x));
  const maxY = Math.max(0, ...visibleNodes.map((n) => n.y));
  const width = maxX - minX + NODE_PADDING * 2;
  const height = maxY + NODE_PADDING * 2;
  const offsetX = NODE_PADDING - minX;
  const offsetY = NODE_PADDING;

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([serialized], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mindmap.svg";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 print:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setView(view === "diagram" ? "outline" : "diagram")}>
          {view === "diagram" ? "Outline view" : "Diagram view"}
        </Button>
        {view === "diagram" && (
          <Button type="button" variant="outline" size="sm" onClick={downloadSvg}>
            Download SVG
          </Button>
        )}
      </div>

      {view === "outline" ? (
        <ul className="list-none space-y-1">
          {tree.rootIds.map((id) => (
            <OutlineNode key={id} tree={tree} id={id} onExplainNode={onExplainNode} />
          ))}
        </ul>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-border">
          <div className="relative" style={{ width, height }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="img"
              aria-label="Mindmap diagram"
              className="absolute inset-0"
            >
              {visibleNodes.map((node) =>
                node.childIds
                  .filter((childId) => shown.has(childId))
                  .map((childId) => {
                    const child = positions.get(childId);
                    if (!child) return null;
                    return (
                      <line
                        key={`${node.id}-${childId}`}
                        x1={node.x + offsetX}
                        y1={node.y + offsetY}
                        x2={child.x + offsetX}
                        y2={child.y + offsetY}
                        stroke="var(--border)"
                        strokeWidth={1.5}
                      />
                    );
                  }),
              )}
            </svg>
            <div className="absolute inset-0">
              {visibleNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => (node.childIds.length > 0 ? toggleCollapse(node.id) : undefined)}
                  title={node.detail}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background px-2 py-1 text-xs whitespace-nowrap"
                  style={{ left: node.x + offsetX, top: node.y + offsetY }}
                >
                  {node.label}
                  {node.childIds.length > 0 && (collapsed.has(node.id) ? " +" : "")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
