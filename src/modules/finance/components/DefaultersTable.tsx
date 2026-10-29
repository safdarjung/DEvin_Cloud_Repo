// T-032 — 06 §W9 defaulters list (AC4: excludes fully paid students).
// `listDefaulters` already filters to issued/part_paid invoices; this is
// pure rendering, same shape as InvoiceTable.
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DefaulterRow } from "@/modules/finance/queries";

export function DefaultersTable({
  institutionSlug,
  defaulters,
}: {
  institutionSlug: string;
  defaulters: DefaulterRow[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Invoice</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>Paid</TableHead>
          <TableHead>Outstanding</TableHead>
          <TableHead>Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {defaulters.map((row) => (
          <TableRow key={row.invoiceId}>
            <TableCell>{row.studentName}</TableCell>
            <TableCell>
              <Link
                href={`/${institutionSlug}/finance/invoices/${row.invoiceId}`}
                className="underline-offset-2 hover:underline"
              >
                {row.invoiceNo}
              </Link>
            </TableCell>
            <TableCell>{row.total.toFixed(2)}</TableCell>
            <TableCell>{row.paidTotal.toFixed(2)}</TableCell>
            <TableCell className="font-medium">{row.outstanding.toFixed(2)}</TableCell>
            <TableCell>{row.dueOn ?? "—"}</TableCell>
          </TableRow>
        ))}
        {defaulters.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground text-center">
              No outstanding invoices for this term.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
