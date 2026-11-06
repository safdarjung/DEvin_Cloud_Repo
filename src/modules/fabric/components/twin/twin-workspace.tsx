"use client";
// F-UI-09 — client orchestrator: holds the state/filters/selection React
// Flow needs, server page.tsx only fetches the snapshot(s) and hands them
// here. "Focus node by label" opens that node's drawer (same as a canvas
// click) — FlowCanvas (shared with the AI canvas, @/lib/genui/flow-canvas)
// isn't modified to add an imperative pan-to-node API just for this lane.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import { downloadFile } from "@/modules/fabric/components/download";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/states";
import type { ChangeImpact, TwinNodeType, TwinSnapshot } from "@/modules/fabric/types";
import type { TwinState } from "@/modules/fabric/twin.queries";
import { EntityDrawer } from "./entity-drawer";
import { TwinLegend } from "./legend";
import { TwinStateToggle } from "./state-toggle";
import { TwinCanvas } from "./twin-canvas";

export function TwinWorkspace({
  base,
  current,
  historical,
  hasHistorical,
}: {
  base: string;
  current: TwinSnapshot | null;
  historical: TwinSnapshot | null;
  hasHistorical: boolean;
}) {
  const [state, setState] = useState<TwinState>("current");
  const [hiddenTypes, setHiddenTypes] = useState<Set<TwinNodeType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  const [query, setQuery] = useState("");

  const snapshot = state === "historical" ? historical : current;

  const impactById = useMemo(() => {
    if (!impact) return undefined;
    return new Map(impact.affected.map((a) => [a.node_id, a.severity]));
  }, [impact]);

  const toggleType = (type: TwinNodeType): void => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const selectNode = (id: string): void => {
    setSelectedId(id);
    setImpact(null);
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const match = snapshot?.nodes.find((n) => n.label.toLowerCase().includes(query.trim().toLowerCase()));
    if (match) selectNode(match.id);
  };

  const exportSnapshot = (): void => {
    if (!snapshot) return;
    downloadFile(`twin-${snapshot.state}-${snapshot.as_of}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  };

  if (!current) {
    return (
      <EmptyState
        title="No published timetable yet"
        description="The digital twin reads the published timetable, rooms and transport routes. Publish a timetable version to see it here."
      />
    );
  }

  const selectedNode = snapshot?.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TwinStateToggle state={state} hasHistorical={hasHistorical} onChange={setState} />
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex items-center gap-1.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a node…"
              className="h-8 w-40"
              aria-label="Find a node by label"
            />
            <Button type="submit" variant="outline" size="icon" className="size-8" aria-label="Search">
              <Search className="size-4" aria-hidden />
            </Button>
          </form>
          <Button type="button" variant="outline" size="sm" onClick={exportSnapshot}>
            <Download className="size-4" aria-hidden />
            Export
          </Button>
          <Link href={`${base}/fabric/simulator`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open simulator
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <TwinLegend hiddenTypes={hiddenTypes} onToggle={toggleType} />

      {snapshot && (
        <div key={state}>
          <TwinCanvas nodes={snapshot.nodes} edges={snapshot.edges} hiddenTypes={hiddenTypes} impactById={impactById} onNodeClick={selectNode} />
        </div>
      )}

      <EntityDrawer
        open={selectedId != null}
        node={selectedNode}
        snapshot={snapshot ?? null}
        base={base}
        impact={impact}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setImpact(null);
          }
        }}
        onFocusNode={selectNode}
        onShowImpact={setImpact}
      />
    </div>
  );
}
