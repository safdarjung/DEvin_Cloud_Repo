// T-032 — 06 §W9 receipt render (AC1). Pure rendering over `ReceiptDetail`,
// which `getReceipt` builds from `receipts.snapshot` only (packet security
// rule 2) — no student/invoice join here, so no name is shown, only ids;
// a live join would make the receipt's displayed content drift if a name
// changed later, which is exactly what the snapshot exists to prevent.
// Reused unchanged by both the normal view page and the print page.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReceiptDetail } from "@/modules/finance/queries";

export function ReceiptView({ receipt, institutionName }: { receipt: ReceiptDetail; institutionName?: string }) {
  const { snapshot } = receipt;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          {institutionName && <p className="text-sm font-medium">{institutionName}</p>}
          <h2 className="text-lg font-semibold">{receipt.receiptNo}</h2>
          <p className="text-muted-foreground text-sm">FY {receipt.financialYear}</p>
        </div>
        <Badge variant="outline">{snapshot.mode}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-1 text-sm sm:w-80">
        <dt className="text-muted-foreground">Received on</dt>
        <dd className="text-right">{new Date(snapshot.receivedAt).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="text-right">{snapshot.reference ?? "—"}</dd>
        <dt className="font-medium">Amount received</dt>
        <dd className="text-right font-medium">{snapshot.amount.toFixed(2)}</dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Head</TableHead>
            <TableHead>Invoice amount</TableHead>
            <TableHead>Concession</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.heads.map((h) => (
            <TableRow key={h.head}>
              <TableCell>{h.head}</TableCell>
              <TableCell>{h.amount.toFixed(2)}</TableCell>
              <TableCell>{h.concessionAmount.toFixed(2)}</TableCell>
            </TableRow>
          ))}
          {snapshot.heads.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground text-center">
                No fee head breakdown on this invoice.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <p className="text-muted-foreground text-xs">
        This is a computer-generated receipt. Contact admin to reverse a recorded payment — there is no cancel path for payments.
      </p>
    </div>
  );
}
