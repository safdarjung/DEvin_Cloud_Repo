// T-031 — read-only invoice line breakdown. Server component: no action
// calls here (recordPayment is out of scope for this packet).
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InvoiceDetail as InvoiceDetailData } from "@/modules/finance/queries";

export function InvoiceDetail({ invoice }: { invoice: InvoiceDetailData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{invoice.invoiceNo}</h2>
          <p className="text-muted-foreground text-sm">{invoice.studentName}</p>
        </div>
        <Badge variant={invoice.status === "paid" ? "default" : "outline"}>{invoice.status}</Badge>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Head</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Concession</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.lines.map((line) => (
            <TableRow key={line.head}>
              <TableCell>{line.head}</TableCell>
              <TableCell>{line.description}</TableCell>
              <TableCell>{line.amount.toFixed(2)}</TableCell>
              <TableCell>{line.concessionAmount.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <dl className="grid grid-cols-2 gap-1 text-sm sm:w-64">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right">{invoice.subtotal.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Concessions</dt>
        <dd className="text-right">-{invoice.concessionTotal.toFixed(2)}</dd>
        <dt className="font-medium">Total</dt>
        <dd className="text-right font-medium">{invoice.total.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Paid</dt>
        <dd className="text-right">{invoice.paidTotal.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Due on</dt>
        <dd className="text-right">{invoice.dueOn ?? "—"}</dd>
      </dl>
    </div>
  );
}
