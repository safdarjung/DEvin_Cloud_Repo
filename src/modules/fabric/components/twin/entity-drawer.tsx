"use client";
// F-UI-09 — node facts + connected nodes + "Show impact" (changeImpact,
// reused unchanged from demo/twin.ts — pure graph logic, lane brief) +
// "Open record" (real page for the 2 types that have one today; hidden for
// room/route, rule 7: no fake destination).
import Link from "next/link";
import { changeImpact } from "@/modules/fabric/demo/twin";
import type { ChangeImpact, TwinNode, TwinSnapshot } from "@/modules/fabric/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SEVERITY } from "@/modules/fabric/components/command/severity";
import { utilisationTier } from "@/modules/fabric/twin.mapping";

const OPEN_RECORD_HREF: Partial<Record<TwinNode["type"], string>> = {
  student_group: "/attendance",
  teacher: "/students",
};

export function EntityDrawer({
  open,
  node,
  snapshot,
  base,
  impact,
  onOpenChange,
  onFocusNode,
  onShowImpact,
}: {
  open: boolean;
  node: TwinNode | null;
  snapshot: TwinSnapshot | null;
  base: string;
  impact: ChangeImpact | null;
  onOpenChange: (open: boolean) => void;
  onFocusNode: (id: string) => void;
  onShowImpact: (impact: ChangeImpact | null) => void;
}) {
  if (!node || !snapshot) return <Sheet open={open} onOpenChange={onOpenChange} />;

  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const connections = snapshot.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      return { otherId, relation: e.relation, label: nodeById.get(otherId)?.label ?? otherId };
    });
  const byRelation = new Map<string, typeof connections>();
  for (const c of connections) byRelation.set(c.relation, [...(byRelation.get(c.relation) ?? []), c]);

  const openRecordHref = OPEN_RECORD_HREF[node.type];
  const tier = node.utilisation_pct != null ? utilisationTier(node.utilisation_pct) : null;
  const showingThisNode = impact?.changed_node_id === node.id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{node.label}</SheetTitle>
          <SheetDescription>{node.type.replace("_", " ")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {node.capacity != null && node.load != null && (
            <p className="text-sm">
              {node.load} / {node.capacity} ({node.utilisation_pct}%
              {tier && <span className={`ml-1 ${SEVERITY.info.text}`}> · {tier}</span>})
            </p>
          )}

          {[...byRelation.entries()].map(([relation, items]) => (
            <div key={relation}>
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">{relation}</p>
              <ul className="space-y-1">
                {items.map((c) => (
                  <li key={`${relation}-${c.otherId}`}>
                    <button
                      type="button"
                      onClick={() => onFocusNode(c.otherId)}
                      className="text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="flex gap-2">
            <Button
              type="button"
              variant={showingThisNode ? "secondary" : "outline"}
              onClick={() => onShowImpact(showingThisNode ? null : changeImpact(snapshot, node.id))}
            >
              {showingThisNode ? "Hide impact" : "Show impact"}
            </Button>
            {openRecordHref && (
              <Link href={`${base}${openRecordHref}`} className={buttonVariants({ variant: "outline" })}>
                Open record
              </Link>
            )}
          </div>

          {showingThisNode && impact && (
            <ul className="space-y-1.5 rounded-lg border p-3 text-sm">
              {impact.affected.length === 0 && <li className="text-muted-foreground">No connected nodes within 2 hops.</li>}
              {impact.affected.map((a) => {
                const sev = SEVERITY[a.severity];
                const label = nodeById.get(a.node_id)?.label ?? a.node_id;
                return (
                  <li key={a.node_id} className="flex items-start gap-1.5">
                    <sev.icon className={`mt-0.5 size-3.5 shrink-0 ${sev.text}`} aria-hidden />
                    <span>
                      <span className="font-medium">{label}</span>: {a.effect}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
