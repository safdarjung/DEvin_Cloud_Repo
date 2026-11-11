"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, RotateCcw, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { saveDashboardLayout } from "@/modules/core/dashboard-layout.actions";
import { applyLayout, MORE_CARD_IDS } from "@/modules/core/dashboard-widgets";
import type { DashboardLayoutInput } from "@/modules/core/schemas";
import { cn } from "cn";

export interface GridCard {
  id: string;
  title: string;
  /** Tailwind column-span classes for the 12-column desktop grid. */
  span: string;
  node: ReactNode;
}

/**
 * Role-adaptive widget grid. The layout is the list of *visible* card ids in
 * order; an id missing from it is hidden. Persisted via the demo store.
 */
export function CommandGrid({ institutionSlug, layout, cards, lead }: { institutionSlug: string; layout: DashboardLayoutInput | null; cards: GridCard[]; lead?: ReactNode }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const defaultOrder = cards.map((c) => c.id);
  const key = (id: string) => `more:${id}` as (typeof MORE_CARD_IDS)[number];
  const [order, setOrder] = useState(() => applyLayout(defaultOrder.map(key), layout).map((id) => id.slice(5)));
  const [customising, setCustomising] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const hidden = cards.filter((c) => !order.includes(c.id));
  const save = (next: string[]) => {
    setOrder(next);
    const rest = defaultOrder.filter((id) => !next.includes(id));
    void saveDashboardLayout(institutionSlug, { order: [...next, ...rest].map(key), hidden: rest.map(key) }).then((r) => {
      if (!r.ok) toast.error(describeActionError(r.error));
    });
  };

  const move = (id: string, delta: number) => {
    const from = order.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    save(next);
  };
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = order.filter((id) => id !== dragId);
    next.splice(next.indexOf(targetId), 0, dragId);
    save(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[min(100%,16rem)] flex-1">{lead}</div>
        {customising && (
          <Button type="button" variant="ghost" size="sm" onClick={() => save(defaultOrder)}>
            <RotateCcw aria-hidden /> Reset layout
          </Button>
        )}
        <Button type="button" variant={customising ? "default" : "outline"} size="sm" aria-pressed={customising} onClick={() => setCustomising((v) => !v)}>
          <SlidersHorizontal aria-hidden /> {customising ? "Done" : "Customise"}
        </Button>
      </div>

      {order.length === 0 ? (
        <EmptyState
          title="Every widget is hidden"
          action={
            <Button type="button" variant="outline" onClick={() => save(defaultOrder)}>
              Show all
            </Button>
          }
        />
      ) : (
        <div className="grid grid-flow-dense grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          {order.map((id, i) => {
            const card = byId.get(id)!;
            return (
              <section
                key={id}
                role="region"
                aria-label={card.title}
                draggable={customising}
                onDragStart={() => setDragId(id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => customising && e.preventDefault()}
                onDrop={() => drop(id)}
                className={cn(
                  "flex min-w-0 flex-col rounded-xl transition-[opacity,box-shadow] duration-(--duration-fast) ease-(--ease-out)",
                  card.span,
                  customising && "ring-2 ring-dashed ring-primary/30",
                  dragId === id && "opacity-50 ring-primary",
                )}
              >
                {customising && (
                  <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <GripVertical className="size-4 cursor-grab max-md:hidden" aria-hidden />
                    <span className="flex-1 truncate font-medium">{card.title}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${card.title} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${card.title} down`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Hide ${card.title}`} onClick={() => save(order.filter((x) => x !== id))}>
                      <EyeOff aria-hidden />
                    </Button>
                  </div>
                )}
                <div className="min-h-0 flex-1 *:h-full">{card.node}</div>
              </section>
            );
          })}
        </div>
      )}

      {customising && hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">Hidden:</span>
          {hidden.map((c) => (
            <Button key={c.id} type="button" variant="outline" size="sm" onClick={() => save([...order, c.id])}>
              <Eye aria-hidden /> {c.title}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
