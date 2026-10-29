import { SimulatedBadge } from "@/components/honesty";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DeliveryLogRow } from "@/modules/notifications/queries";

// Acceptance criterion 3 — SMS/email rows always carry the Simulated badge
// and never a provider reference (06 §3, 07 §3 "delivery logs are
// confidential"); `queries.ts` never selects `to_address`/`provider` for
// this view in the first place.
export function MessageLog({ rows }: { rows: DeliveryLogRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No delivery attempts.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Channel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Message</TableHead>
          <TableHead>Attempted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.notificationType}</TableCell>
            <TableCell className="uppercase">{row.channel}</TableCell>
            <TableCell>
              {row.channel === "in_app" ? (
                <Badge variant="secondary">{row.status}</Badge>
              ) : (
                <SimulatedBadge />
              )}
            </TableCell>
            <TableCell className="max-w-sm truncate text-sm text-muted-foreground" title={row.renderedBody}>
              {row.renderedBody}
            </TableCell>
            <TableCell>{new Date(row.attemptedAt).toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
