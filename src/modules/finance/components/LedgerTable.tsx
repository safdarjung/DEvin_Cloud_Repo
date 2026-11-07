// T-032 — 06 §W9 ledger view (AC4: Sigma debit = Sigma credit for the
// selected range). Pure rendering over `listLedgerEntries`'s already-paged,
// already-summed result; the ledger page owns the date-range/account filter
// form and pagination links.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { inr } from "@/lib/format";
import type { LedgerPage } from "@/modules/finance/queries";

export function LedgerTable({ ledger }: { ledger: LedgerPage }) {
  // Fix round 1 (code review, MEDIUM): "balanced" comes from
  // `listLedgerEntries`'s integer-paise comparison, not a float `===` on
  // `totalDebit`/`totalCredit` here — see queries.ts.
  const { balanced } = ledger;

  return (
    <div className="space-y-3">
      {ledger.entries.length === 0 ? (
        <EmptyState title="No ledger entries" description="Nothing was posted in this range." />
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="hidden sm:table-cell">Memo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{entry.entryDate}</TableCell>
              <TableCell>{entry.account}</TableCell>
              <TableCell className="text-right tabular-nums">{entry.debit > 0 ? inr(entry.debit) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{entry.credit > 0 ? inr(entry.credit) : "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{entry.memo ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Total debit</dt>
          <dd className="font-medium tabular-nums">{inr(ledger.totalDebit)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Total credit</dt>
          <dd className="font-medium tabular-nums">{inr(ledger.totalCredit)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Balanced</dt>
          <dd className={balanced ? "font-medium" : "text-destructive font-medium"}>{balanced ? "Yes" : "No"}</dd>
        </div>
      </dl>
    </div>
  );
}
