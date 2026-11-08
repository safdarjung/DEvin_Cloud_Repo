import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Widget, type WidgetProps } from "@/components/widgets/widget";
import { cn } from "cn";

export interface TimetablePeriod {
  /** "HH:MM", 24h, IST. */
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  room?: string;
  isCurrent?: boolean;
  isNext?: boolean;
}

/** Stacked rows (never a horizontal scroller) so it reads on a phone. */
export function TimetableWidget({
  periods,
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & { periods: TimetablePeriod[] }) {
  return (
    <Widget {...frame} isEmpty={periods.length === 0} empty={<EmptyState bare title="No periods today" />}>
      <ol className="space-y-1.5">
        {periods.map((p) => (
          <li
            key={p.start}
            aria-current={p.isCurrent ? "true" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2",
              p.isCurrent && "border-primary/30 bg-primary/10",
              p.isNext && "border-dashed border-primary/40",
            )}
          >
            <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
              {p.start}–{p.end}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.title}</p>
              {(p.subtitle || p.room) && (
                <p className="truncate text-xs text-muted-foreground">{[p.subtitle, p.room].filter(Boolean).join(" · ")}</p>
              )}
            </div>
            {p.isCurrent && <Badge>Now</Badge>}
            {p.isNext && <Badge variant="outline">Next</Badge>}
          </li>
        ))}
      </ol>
    </Widget>
  );
}
