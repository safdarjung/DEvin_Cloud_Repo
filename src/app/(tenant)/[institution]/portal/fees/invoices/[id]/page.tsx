import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { InvoiceDetail } from "@/modules/finance/components/InvoiceDetail";
import { invoiceStatusVariant } from "@/modules/finance/format";
import { getInvoice } from "@/modules/finance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Invoice" };

// Family view of one invoice. RLS already hides other families' invoices;
// the studentId check stops a guardian opening one child's invoice under another child's slot.
export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; id: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/fees/invoices/${id}`, allParams);
  const invoice = await getInvoice(ctx, id);
  if (!invoice || invoice.studentId !== selection.studentId) notFound();

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/fees"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn className="space-y-4">
        <PageHeader
          title={invoice.invoiceNo}
          description={invoice.studentName}
          back={{ href: `/${institutionSlug}/portal/fees?student=${selection.studentId}`, label: "Fees" }}
          actions={<Badge variant={invoiceStatusVariant(invoice.status)}>{humanize(invoice.status)}</Badge>}
        />
        <InvoiceDetail invoice={invoice} />
      </FadeIn>
    </>
  );
}
