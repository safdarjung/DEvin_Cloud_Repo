// T-031 — read-only invoice line breakdown. Server component: no action
// calls here (recordPayment is out of scope for this packet).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inr } from "@/lib/format";
import type { InvoiceDetail as InvoiceDetailData } from "@/modules/finance/queries";

export function InvoiceDetail({ invoice }: { invoice: InvoiceDetailData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="min-w-0 self-start lg:col-span-2">
        <CardHeader>
          <CardTitle>Fee lines</CardTitle>
        </CardHeader>
        <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Head</TableHead>
            <TableHead className="hidden sm:table-cell">Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Concession</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.lines.map((line) => (
            <TableRow key={line.head}>
              <TableCell>{line.head}</TableCell>
              <TableCell className="hidden sm:table-cell">{line.description}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(line.amount)}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(line.concessionAmount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{inr(invoice.subtotal)}</dd>
            <dt className="text-muted-foreground">Concessions</dt>
            <dd className="text-right">-{inr(invoice.concessionTotal)}</dd>
            <dt className="font-medium">Total</dt>
            <dd className="text-right font-medium">{inr(invoice.total)}</dd>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="text-right">{inr(invoice.paidTotal)}</dd>
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd className="text-right font-medium">{inr(invoice.total - invoice.paidTotal)}</dd>
            <dt className="text-muted-foreground">Due on</dt>
            <dd className="text-right">{invoice.dueOn ?? "—"}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
