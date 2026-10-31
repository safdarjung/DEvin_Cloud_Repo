import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { GenerateInvoicesPanel } from "@/modules/finance/components/GenerateInvoicesPanel";
import { InvoiceTable } from "@/modules/finance/components/InvoiceTable";
import { listGradeOptions, listInvoices, listTermOptions } from "@/modules/finance/queries";

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ termId?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { termId } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const canGenerate = hasPermission(ctx, "finance.invoice.generate");
  const [invoices, terms, grades] = await Promise.all([
    listInvoices(ctx, { termId }),
    canGenerate ? listTermOptions(ctx) : Promise.resolve([]),
    canGenerate ? listGradeOptions(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Invoices" description="Term invoices and their payment status." back={{ href: `/${institutionSlug}/finance`, label: "Finance" }} />
      {canGenerate && <GenerateInvoicesPanel institutionSlug={institutionSlug} terms={terms} grades={grades} />}
      <InvoiceTable institutionSlug={institutionSlug} invoices={invoices} />
    </div>
  );
}
