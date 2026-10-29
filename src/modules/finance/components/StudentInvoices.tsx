// T-032 — reusable invoice list for a single student (AC5), exported for
// the guardian/student portal (T-034) and the staff student profile
// (T-028). Same server-component shape as
// StudentAttendanceSummary (src/modules/attendance/components) — fetches
// with `ctx` directly; `invoices` RLS scopes to `finance_roles()` or the
// caller's own/guarded student, so a guardian calling this for any
// `studentId` that isn't their child gets an empty list, not an error
// (packet: "RLS does the scoping" — no extra guardian-id check needed here).
// Deviation: the packet asked for a new `listStudentInvoices(studentId)`
// query; T-028 already added an equivalent `listInvoicesForStudent(ctx,
// studentId)` to this module's queries.ts, so this component reuses that
// instead of adding a duplicate query function (CLAUDE.md rule 10: no
// drive-by duplication).
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TenantContext } from "@/lib/auth/types";
import { listInvoicesForStudent } from "@/modules/finance/queries";

interface StudentInvoicesProps {
  ctx: TenantContext;
  institutionSlug: string;
  studentId: string;
}

export async function StudentInvoices({ ctx, institutionSlug, studentId }: StudentInvoicesProps) {
  const invoices = await listInvoicesForStudent(ctx, studentId);

  if (invoices.length === 0) {
    return <p className="text-muted-foreground text-sm">No invoices yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>Paid</TableHead>
          <TableHead>Due on</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell>
              <Link
                href={`/${institutionSlug}/finance/invoices/${invoice.id}`}
                className="underline-offset-2 hover:underline"
              >
                {invoice.invoiceNo}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={invoice.status === "paid" ? "default" : "outline"}>{invoice.status}</Badge>
            </TableCell>
            <TableCell>{invoice.total.toFixed(2)}</TableCell>
            <TableCell>{invoice.paidTotal.toFixed(2)}</TableCell>
            <TableCell>{invoice.dueOn ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
