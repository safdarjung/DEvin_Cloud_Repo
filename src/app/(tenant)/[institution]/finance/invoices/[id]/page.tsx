import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { InvoiceDetail } from "@/modules/finance/components/InvoiceDetail";
import { getInvoice } from "@/modules/finance/queries";

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

  return (
    <div className="max-w-2xl">
      <InvoiceDetail invoice={invoice} />
    </div>
  );
}
