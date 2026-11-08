import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { InvoiceDetail } from "@/modules/finance/components/InvoiceDetail";
import { RecordPaymentDialog } from "@/modules/finance/components/RecordPaymentDialog";
import { humanize } from "@/lib/format";
import { invoiceStatusVariant } from "@/modules/finance/format";
import { getInvoice, paymentModesFor } from "@/modules/finance/queries";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const invoice = await getInvoice(ctx, id);
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
    </div>
  );
}
