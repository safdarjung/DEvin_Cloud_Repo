import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Stagger, StaggerItem } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Widget, type WidgetProps } from "@/components/widgets/widget";
import type { BadgeVariant } from "@/lib/format";

export interface ListRow {
  id: string;
  title: string;
  meta?: string;
  href?: string;
  badge?: { label: string; variant: BadgeVariant };
}

export function ListWidget({
  rows,
  emptyTitle = "Nothing here yet",
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & { rows: ListRow[]; emptyTitle?: string }) {
  return (
    <Widget {...frame} isEmpty={rows.length === 0} empty={<EmptyState bare title={emptyTitle} />}>
      <Stagger className="divide-y">
        {rows.map((r) => {
          const body = (
            <div className="flex min-h-11 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                {r.meta && <p className="truncate text-xs text-muted-foreground">{r.meta}</p>}
              </div>
              {r.badge && <Badge variant={r.badge.variant}>{r.badge.label}</Badge>}
            </div>
          );
          return (
            <StaggerItem key={r.id}>
              {r.href ? (
                <Link href={r.href} className="block rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  {body}
                </Link>
              ) : (
                body
              )}
            </StaggerItem>
          );
        })}
      </Stagger>
    </Widget>
  );
}
