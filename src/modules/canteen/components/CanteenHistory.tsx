import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inr } from "@/lib/format";
import type { CanteenTransaction } from "@/modules/canteen/queries";

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Paise -> display rupees. Display only; the balance itself always comes from canteen_balance(). */
export function paise(value: number): string {
  return inr(value / 100);
}

// Shared by the staff counter and the guardian/student portal: rows are
// whatever RLS let the caller read.
export function CanteenHistory({ transactions }: { transactions: CanteenTransaction[] }) {
  if (transactions.length === 0) {
    return <EmptyState bare title="No canteen activity yet" description="Top-ups and purchases appear here." />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{when.format(new Date(t.createdAt))}</TableCell>
            <TableCell>
              {t.kind === "topup" ? (
                <span className="inline-flex items-center gap-2">
                  <Badge variant="info">Top-up</Badge>
                  {t.note && <span className="text-muted-foreground">{t.note}</span>}
                </span>
              ) : (
                <span>
                  {t.itemName ?? "Item"} × {t.quantity}
                </span>
              )}
            </TableCell>
            <TableCell className={`text-right tabular-nums ${t.amountPaise < 0 ? "" : "text-success"}`}>
              {t.amountPaise < 0 ? "−" : "+"}
              {paise(Math.abs(t.amountPaise))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
