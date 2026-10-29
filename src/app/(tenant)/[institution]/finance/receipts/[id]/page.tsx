import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { ReceiptView } from "@/modules/finance/components/ReceiptView";
import { getReceipt } from "@/modules/finance/queries";

// T-032 — 06 §W9 (AC1). `finance.read` is granted to staff finance roles
// and, per the matrix's guardian/student "s" (own-scope) cells, to
// guardian/student too — the own-scope limit itself is `receipts_select`'s
// RLS policy (finance.sql §"guardian/student own-scope SELECT"), not this
// permission check (packet security rule: "the page still calls
// requirePermission('finance.read')" even though RLS already scopes it).
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const receipt = await getReceipt(ctx, id);
  if (!receipt) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link href={`/${institutionSlug}/finance/receipts/${id}/print`}>Print</Link>
        </Button>
      </div>
      <ReceiptView receipt={receipt} institutionName={ctx.institution.name} />
    </div>
  );
}
