// F-BE-03 / D36 — the single dispatch point for a Fabric Canvas spec
// (src/modules/fabric/spec/schemas.ts). Blocks → BlockRenderer, widgets →
// widget-registry, layouts → grid/stack/tabs/split, flow → placeholder.
// No "use client" and no hooks, same as BlockRenderer: it renders inside
// whichever boundary its caller is in (onAction is a function, so in
// practice a client parent). Actions are data: this file only hands them to
// `onAction`, it never navigates, mutates, or calls a server action itself
// (CLAUDE.md rule 6). No dangerouslySetInnerHTML anywhere in the tree.
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Widget } from "@/components/widgets/widget";
import { flowFromSpec } from "@/lib/genui/flow-from-spec";
import { canvasIcon, WIDGETS } from "@/lib/genui/widget-registry";
import { BlockRenderer } from "@/modules/ai/blocks/BlockRenderer";
import type { CanvasAction, CanvasNode, CanvasSpec, LayoutNode, WidgetNode } from "@/modules/fabric/spec/schemas";

type OnAction = (action: CanvasAction) => void;

export interface CanvasRendererProps {
  spec: CanvasSpec;
  onAction: OnAction;
}

// Static class strings so Tailwind sees them; index = cols - 1.
const GRID_COLS = ["md:grid-cols-1", "md:grid-cols-2", "md:grid-cols-3", "md:grid-cols-4"];

export function CanvasRenderer({ spec, onAction }: CanvasRendererProps) {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  // Depth guard: the schema rejects cycles, this only stops an unparsed spec from recursing forever.
  const render = (id: string, depth: number): ReactNode => {
    const node = byId.get(id);
    if (!node || depth > spec.nodes.length) return null;
    return <NodeView node={node} onAction={onAction} renderChild={(child) => render(child, depth + 1)} />;
  };
  return render(spec.root, 0);
}

// Client-only: @xyflow/react touches window; SSR renders the placeholder.
const FlowCanvas = dynamic(() => import("@/lib/genui/flow-canvas"), {
  ssr: false,
  loading: () => <div className="h-[480px] animate-pulse rounded-xl border border-dashed" aria-hidden />,
});

function FlowView({ node }: { node: Extract<CanvasNode, { kind: "flow" }> }) {
  const { nodes, edges } = flowFromSpec({ nodes: node.nodes, edges: node.edges });
  return <FlowCanvas nodes={nodes} edges={edges} />;
}

function NodeView({ node, onAction, renderChild }: { node: CanvasNode; onAction: OnAction; renderChild: (id: string) => ReactNode }) {
  switch (node.kind) {
    case "layout":
      return <LayoutView node={node} renderChild={renderChild} />;
    case "widget":
      return <WidgetView node={node} onAction={onAction} />;
    case "flow":
      return <FlowView node={node} />;
    case "callout":
      return (
        <Actionable action={node.action} onAction={onAction}>
          <BlockRenderer block={node} />
        </Actionable>
      );
    default:
      return <BlockRenderer block={node} />;
  }
}

function LayoutView({ node, renderChild }: { node: LayoutNode; renderChild: (id: string) => ReactNode }) {
  // Index keys: the same child id may legally appear in two places.
  const children = node.children.map((id, i) => <div key={`${i}-${id}`} className="min-w-0">{renderChild(id)}</div>);
  switch (node.variant) {
    case "stack":
      return <div className="flex flex-col gap-4">{children}</div>;
    case "split":
      return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
    case "grid":
      return <div className={`grid grid-cols-1 gap-4 ${GRID_COLS[(node.cols ?? 2) - 1]}`}>{children}</div>;
    case "tabs":
      return (
        <Tabs defaultValue="0">
          <TabsList>
            {node.children.map((id, i) => (
              <TabsTrigger key={`${i}-${id}`} value={String(i)}>
                {node.tabTitles?.[i] ?? `Tab ${i + 1}`}
              </TabsTrigger>
            ))}
          </TabsList>
          {node.children.map((id, i) => (
            <TabsContent key={`${i}-${id}`} value={String(i)}>
              {renderChild(id)}
            </TabsContent>
          ))}
        </Tabs>
      );
  }
}

function WidgetView({ node, onAction }: { node: WidgetNode; onAction: OnAction }) {
  switch (node.name) {
    case "kpi": {
      const { action, href, ...props } = node.props;
      // An action replaces the link: never nest a button and an anchor.
      return (
        <Actionable action={action} onAction={onAction}>
          <WIDGETS.kpi {...props} href={action ? undefined : href} />
        </Actionable>
      );
    }
    case "trend":
      return <WIDGETS.trend {...node.props} icon={canvasIcon(node.props.icon)} />;
    case "list": {
      const { rows, ...props } = node.props;
      if (!rows.some((row) => row.action)) return <WIDGETS.list {...props} rows={rows} icon={canvasIcon(props.icon)} />;
      return <ActionableList {...props} rows={rows} onAction={onAction} />;
    }
    case "timeline":
      return <WIDGETS.timeline {...node.props} icon={canvasIcon(node.props.icon)} now={new Date()} />;
    case "approvals":
      return <WIDGETS.approvals {...node.props} icon={canvasIcon(node.props.icon)} />;
    case "staffAvailability":
      return <WIDGETS.staffAvailability {...node.props} icon={canvasIcon(node.props.icon)} />;
    case "timetable":
      return <WIDGETS.timetable {...node.props} icon={canvasIcon(node.props.icon)} />;
    case "aiInsight":
      return <WIDGETS.aiInsight {...node.props} />;
    case "quickActions":
      return <WIDGETS.quickActions {...node.props} actions={node.props.actions.map((a) => ({ ...a, icon: canvasIcon(a.icon) }))} />;
  }
}

function Actionable({ action, onAction, children }: { action?: CanvasAction; onAction: OnAction; children: ReactNode }) {
  if (!action) return children;
  return (
    <button
      type="button"
      onClick={() => onAction(action)}
      className="block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

// ListWidget renders rows as links only; rows that carry an action need a button, so this mirrors its row markup.
function ActionableList({
  rows,
  emptyTitle = "Nothing here yet",
  icon,
  onAction,
  ...frame
}: Extract<WidgetNode, { name: "list" }>["props"] & { onAction: OnAction }) {
  return (
    <Widget {...frame} icon={canvasIcon(icon)} isEmpty={rows.length === 0} empty={<EmptyState bare title={emptyTitle} />}>
      <ul className="divide-y">
        {rows.map((row) => {
          const body = (
            <div className="flex min-h-11 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.title}</p>
                {row.meta && <p className="truncate text-xs text-muted-foreground">{row.meta}</p>}
              </div>
              {row.badge && <Badge variant={row.badge.variant}>{row.badge.label}</Badge>}
            </div>
          );
          return (
            <li key={row.id}>
              {row.action || !row.href ? (
                <Actionable action={row.action} onAction={onAction}>
                  {body}
                </Actionable>
              ) : (
                <Link href={row.href} className="block rounded-md outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
