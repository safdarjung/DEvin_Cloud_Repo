// T-032 — 06 §W9 ledger view (AC4: Sigma debit = Sigma credit for the
// selected range). Pure rendering over `listLedgerEntries`'s already-paged,
// already-summed result; the ledger page owns the date-range/account filter
// form and pagination links.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LedgerPage } from "@/modules/finance/queries";

export function LedgerTable({ ledger }: { ledger: LedgerPage }) {
  // Fix round 1 (code review, MEDIUM): "balanced" comes from
  // `listLedgerEntries`'s integer-paise comparison, not a float `===` on
  // `totalDebit`/`totalCredit` here — see queries.ts.
  const { balanced } = ledger;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Debit</TableHead>
            <TableHead>Credit</TableHead>
            <TableHead>Memo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{entry.entryDate}</TableCell>
              <TableCell>{entry.account}</TableCell>
              <TableCell>{entry.debit > 0 ? entry.debit.toFixed(2) : "—"}</TableCell>
              <TableCell>{entry.credit > 0 ? entry.credit.toFixed(2) : "—"}</TableCell>
              <TableCell className="text-muted-foreground">{entry.memo ?? "—"}</TableCell>
            </TableRow>
          ))}
          {ledger.entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                No ledger entries for this range.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <dl className="flex gap-6 text-sm">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Total debit</dt>
          <dd className="font-medium">{ledger.totalDebit.toFixed(2)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Total credit</dt>
          <dd className="font-medium">{ledger.totalCredit.toFixed(2)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Balanced</dt>
          <dd className={balanced ? "font-medium" : "text-destructive font-medium"}>{balanced ? "Yes" : "No"}</dd>
        </div>
      </dl>
    </div>
  );
}
