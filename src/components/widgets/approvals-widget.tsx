import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Widget, type WidgetProps } from "@/components/widgets/widget";
import { humanize } from "@/lib/format";

export interface ApprovalRow {
  id: string;
  /** e.g. "leave", "fee_waiver", "tc", "event". */
  kind: string;
  title: string;
  requestedBy: string;
  /** Pre-formatted, e.g. "2 h". */
  age: string;
  href?: string;
}

export function ApprovalsWidget({
  rows,
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & { rows: ApprovalRow[] }) {
  return (
    <Widget {...frame} isEmpty={rows.length === 0} empty={<EmptyState title="No pending approvals" />}>
      <ul className="divide-y">
        {rows.map((r) => {
          const body = (
            <div className="flex min-h-11 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.requestedBy} · {r.age}
                </p>
              </div>
              <Badge variant="outline">{humanize(r.kind)}</Badge>
            </div>
          );
          return (
            <li key={r.id}>
              {r.href ? (
                <Link href={r.href} className="block rounded-md outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
