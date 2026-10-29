"use client";

// T-031 — invoice list (AC4: status filter). Client-side filter over the
// already-fetched rows — the page passes every invoice for the selected
// term/grade, and this is just a view over it.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InvoiceSummary } from "@/modules/finance/queries";

const STATUS_OPTIONS = ["all", "issued", "part_paid", "paid", "cancelled"] as const;

interface InvoiceTableProps {
  institutionSlug: string;
  invoices: InvoiceSummary[];
}

export function InvoiceTable({ institutionSlug, invoices }: InvoiceTableProps) {
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");

  const filtered = useMemo(
    () => (status === "all" ? invoices : invoices.filter((i) => i.status === status)),
    [invoices, status],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium" htmlFor="statusFilter">
          Status
        </label>
        <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUS_OPTIONS)[number])}>
          <SelectTrigger id="statusFilter" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Due</TableHead>
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
              <TableCell>{invoice.studentName}</TableCell>
              <TableCell>
                <Badge variant={invoice.status === "paid" ? "default" : "outline"}>{invoice.status}</Badge>
              </TableCell>
              <TableCell>{invoice.total.toFixed(2)}</TableCell>
              <TableCell>{invoice.paidTotal.toFixed(2)}</TableCell>
              <TableCell>{invoice.dueOn ?? "—"}</TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground text-center">
                No invoices for this filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
