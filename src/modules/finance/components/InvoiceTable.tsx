"use client";

// T-031 — invoice list (AC4: status filter). Client-side filter over the
// already-fetched rows — the page passes every invoice for the selected
// term/grade, and this is just a view over it.
import { Label } from "@/components/ui/label";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, inr } from "@/lib/format";
import { invoiceStatusVariant } from "@/modules/finance/format";
import type { InvoiceSummary } from "@/modules/finance/queries";

const STATUS_OPTIONS = ["all", "issued", "part_paid", "paid", "cancelled"] as const;

interface InvoiceTableProps {
  institutionSlug: string;
  invoices: InvoiceSummary[];
  /** The page already filtered server-side (status/search); hide the client status filter. */
  serverFiltered?: boolean;
}

export function InvoiceTable({ institutionSlug, invoices, serverFiltered }: InvoiceTableProps) {
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");

  const filtered = useMemo(
    () => (status === "all" ? invoices : invoices.filter((i) => i.status === status)),
    [invoices, status],
  );

  return (
    <div className="space-y-3">
      {!serverFiltered && <div className="flex items-center gap-2">
        <Label htmlFor="statusFilter">
          Status
        </Label>
        <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUS_OPTIONS)[number])}>
          <SelectTrigger id="statusFilter" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All" : humanize(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>}

      {filtered.length === 0 ? (
        <EmptyState title="No invoices" description="No invoices match this filter." />
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead className="hidden sm:table-cell">Student</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
            <TableHead className="hidden sm:table-cell">Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell>
                <Link href={`/${institutionSlug}/finance/invoices/${invoice.id}`} className="underline-offset-2 hover:underline">
                  {invoice.invoiceNo}
                </Link>
              </TableCell>
              <TableCell className="hidden sm:table-cell">{invoice.studentName}</TableCell>
              <TableCell>
                <Badge variant={invoiceStatusVariant(invoice.status)}>{humanize(invoice.status)}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{inr(invoice.total)}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{inr(invoice.paidTotal)}</TableCell>
              <TableCell className="hidden sm:table-cell">{invoice.dueOn ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}
    </div>
  );
}
