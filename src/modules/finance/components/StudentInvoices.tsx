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
import { EmptyState } from "@/components/states";
import type { TenantContext } from "@/lib/auth/types";
import { humanize, inr } from "@/lib/format";
import { invoiceStatusVariant } from "@/modules/finance/format";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { PayNowButton } from "@/modules/finance/components/PayNowButton";

interface StudentInvoicesProps {
  ctx: TenantContext;
  institutionSlug: string;
  studentId: string;
  /** Guardian with finance.payment.online: show Pay now on open invoices. */
  payOnline?: boolean;
}

export async function StudentInvoices({ ctx, institutionSlug, studentId, payOnline = false }: StudentInvoicesProps) {
  const invoices = await listInvoicesForStudent(ctx, studentId);

  if (invoices.length === 0) {
    return <EmptyState title="No invoices yet" />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
          <TableHead className="hidden sm:table-cell">Due on</TableHead>
          {payOnline && <TableHead className="text-right">Pay</TableHead>}
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
              <Badge variant={invoiceStatusVariant(invoice.status)}>{humanize(invoice.status)}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{inr(invoice.total)}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">{inr(invoice.paidTotal)}</TableCell>
            <TableCell className="hidden sm:table-cell">{invoice.dueOn ?? "—"}</TableCell>
            {payOnline && (
              <TableCell className="text-right">
                {(invoice.status === "issued" || invoice.status === "part_paid") && invoice.total - invoice.paidTotal > 0 && (
                  <PayNowButton
                    institutionSlug={institutionSlug}
                    invoiceId={invoice.id}
                    amount={Math.round((invoice.total - invoice.paidTotal) * 100) / 100}
                  />
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
