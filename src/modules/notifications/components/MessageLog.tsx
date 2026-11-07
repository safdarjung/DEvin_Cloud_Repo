import type { ComponentProps } from "react";
import { SimulatedBadge } from "@/components/honesty";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DeliveryLogRow } from "@/modules/notifications/queries";
import { humanize } from "@/lib/format";

type Variant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

// delivery_attempts.status check: 20261028000003_platform.sql
function deliveryStatusVariant(status: string): Variant {
  switch (status) {
    case "sent":
      return "success";
    case "simulated":
      return "info";
    case "queued":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

// M17 T4: Badge flips on delivery status. Show <SimulatedBadge /> only when
// status==="simulated"; otherwise show the delivery status badge. SMS/email rows
// never carry provider reference (06 §3, 07 §3 "delivery logs confidential");
// queries.ts never selects to_address/provider for this view.
export function MessageLog({ rows }: { rows: DeliveryLogRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No delivery attempts" />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead className="hidden sm:table-cell">Channel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Message</TableHead>
          <TableHead className="hidden sm:table-cell">Attempted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {humanize(row.notificationType)}
              <p className="mt-0.5 line-clamp-2 text-xs whitespace-normal text-muted-foreground sm:hidden">{row.renderedBody}</p>
            </TableCell>
            <TableCell className="hidden uppercase sm:table-cell">{humanize(row.channel)}</TableCell>
            <TableCell>
              {row.status === "simulated" ? (
                <SimulatedBadge />
              ) : (
                <Badge variant={deliveryStatusVariant(row.status)}>{humanize(row.status)}</Badge>
              )}
            </TableCell>
            <TableCell className="hidden max-w-sm truncate text-sm text-muted-foreground sm:table-cell" title={row.renderedBody}>
              {row.renderedBody}
            </TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">{new Date(row.attemptedAt).toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
