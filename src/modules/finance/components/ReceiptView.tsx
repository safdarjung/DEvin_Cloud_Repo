// T-032 — 06 §W9 receipt render (AC1). Pure rendering over `ReceiptDetail`,
// which `getReceipt` builds from `receipts.snapshot` only (packet security
// rule 2) — no student/invoice join here; a live join would make the
// receipt's displayed content drift if a name changed later, which is
// exactly what the snapshot exists to prevent.
// T-032 phase 2 (20261028000021): school/student name, admission no,
// class/section, invoice/term/receipt number now all come from the
// snapshot too (previously the school name was a live `ctx.institution.name`
// prop) — every display field on this page is frozen at payment time.
// Reused unchanged by both the normal view page and the print page.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, inr } from "@/lib/format";
import type { ReceiptDetail } from "@/modules/finance/queries";

export function ReceiptView({ receipt }: { receipt: ReceiptDetail }) {
  const { snapshot } = receipt;

  return (
    <div className="min-w-0 space-y-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-6 print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <div className="flex items-start justify-between gap-3 border-b-2 border-border pb-3">
        <div className="min-w-0">
          {snapshot.schoolName && <p className="text-sm font-medium">{snapshot.schoolName}</p>}
          <h2 className="text-lg font-semibold">{receipt.receiptNo}</h2>
          <p className="text-muted-foreground text-sm">FY {receipt.financialYear}</p>
        </div>
        <Badge variant="outline">{humanize(snapshot.mode)}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:w-96">
        <dt className="text-muted-foreground">Student</dt>
        <dd className="text-right">{snapshot.studentName || "—"}</dd>
        <dt className="text-muted-foreground">Admission no</dt>
        <dd className="text-right">{snapshot.admissionNo || "—"}</dd>
        <dt className="text-muted-foreground">Class</dt>
        <dd className="text-right">{snapshot.classLabel || "—"}</dd>
        <dt className="text-muted-foreground">Invoice</dt>
        <dd className="text-right">
          {snapshot.invoiceNo || "—"}
          {snapshot.termName ? ` (${snapshot.termName})` : ""}
        </dd>
        <dt className="text-muted-foreground">Received on</dt>
        <dd className="text-right">{new Date(snapshot.receivedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="text-right">{snapshot.reference ?? "—"}</dd>
        <dt className="font-medium">Amount received</dt>
        <dd className="text-right font-medium tabular-nums">{inr(snapshot.amount)}</dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Head</TableHead>
            <TableHead className="text-right">Invoice amount</TableHead>
            <TableHead className="text-right">Concession</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.heads.map((h) => (
            <TableRow key={h.head}>
              <TableCell>{h.head}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(h.amount)}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(h.concessionAmount)}</TableCell>
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
