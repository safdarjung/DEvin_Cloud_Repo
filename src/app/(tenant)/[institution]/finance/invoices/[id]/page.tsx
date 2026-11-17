import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { InvoiceDetail } from "@/modules/finance/components/InvoiceDetail";
import { RecordPaymentDialog } from "@/modules/finance/components/RecordPaymentDialog";
import { formatDateTime, humanize, inr } from "@/lib/format";
import { invoiceStatusVariant, paymentModeLabel } from "@/modules/finance/format";
import { getInvoice, listInvoicePayments, paymentModesFor } from "@/modules/finance/queries";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const [invoice, payments] = await Promise.all([getInvoice(ctx, id), listInvoicePayments(ctx, id)]);
  if (!invoice) notFound();

  // T-032 — admin has `finance.read` but not `finance.payment.record`
  // (07 §2.2); the dialog only renders for roles that can actually call
  // `recordPayment`, which re-checks the permission server-side regardless.
  const canRecordPayment = hasPermission(ctx, "finance.payment.record");
  const outstanding = invoice.total - invoice.paidTotal;

  return (
    <div>
      <PageHeader
        title={invoice.invoiceNo}
        description={invoice.studentName}
        back={{ href: `/${institutionSlug}/finance/invoices`, label: "Invoices" }}
        actions={
          <>
            <Badge variant={invoiceStatusVariant(invoice.status)}>{humanize(invoice.status)}</Badge>
            {canRecordPayment && outstanding > 0 && (
              <RecordPaymentDialog
                institutionSlug={institutionSlug}
                invoiceId={invoice.id}
                outstanding={outstanding}
                paymentModes={paymentModesFor(ctx.institution.settings)}
              />
            )}
          </>
        }
      />
      <InvoiceDetail invoice={invoice} />
      <Card className="mt-4 min-w-0">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded on this invoice yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDateTime(p.receivedAt)}</TableCell>
                    <TableCell>
                      {paymentModeLabel(p.mode)}
                      {p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                    <TableCell>
                      {p.receiptId ? (
                        <Link href={`/${institutionSlug}/finance/receipts/${p.receiptId}`} className="underline underline-offset-4 hover:text-primary">
                          {p.receiptNo}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {p.reversalKind && (
                        <Badge variant="destructive" className="ms-2">
                          {humanize(p.reversalKind)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
