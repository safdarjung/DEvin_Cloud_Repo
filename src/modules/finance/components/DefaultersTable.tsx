// T-032 — 06 §W9 defaulters list (AC4: excludes fully paid students).
// `listDefaulters` already filters to issued/part_paid invoices; this is
// pure rendering, same shape as InvoiceTable.
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { inr } from "@/lib/format";
import type { DefaulterRow } from "@/modules/finance/queries";

// Row entrance: CSS only, `from`-state held during the delay, skipped under reduced motion.
const ROW_ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)";
const rowDelay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 25}ms` });

export function DefaultersTable({
  institutionSlug,
  defaulters,
}: {
  institutionSlug: string;
  defaulters: DefaulterRow[];
}) {
  if (defaulters.length === 0) {
    return <EmptyState title="No outstanding invoices" description="Nothing is pending for this term." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Invoice</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
          <TableHead className="hidden sm:table-cell">Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {defaulters.map((row, i) => (
          <TableRow key={row.invoiceId} className={ROW_ENTER} style={rowDelay(i)}>
            <TableCell>{row.studentName}</TableCell>
            <TableCell>
              <Link
                href={`/${institutionSlug}/finance/invoices/${row.invoiceId}`}
                className="underline-offset-2 hover:underline"
              >
                {row.invoiceNo}
              </Link>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{inr(row.total)}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{inr(row.paidTotal)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{inr(row.outstanding)}</TableCell>
            <TableCell className="hidden sm:table-cell">{row.dueOn ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
