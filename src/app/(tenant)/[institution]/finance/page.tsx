import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";

export default async function FinancePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const canManageStructures = hasPermission(ctx, "finance.structure.manage");

  return (
    <div className="space-y-4">
      <PageHeader title="Finance" description="Fee structures, invoices and payments." />
      <div className="grid gap-4 sm:grid-cols-2">
        {canManageStructures && (
          <Link href={`/${institutionSlug}/finance/structures`} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>Fee structures &amp; assignments</CardTitle>
                <CardDescription>Per-grade fee components and student assignments.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        <Link href={`/${institutionSlug}/finance/invoices`} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>View invoices and record payments.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
