import { PageHeader } from "@/components/page-header";
import { SimulatedBadge } from "@/components/honesty";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";

export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  return (
    <div className="space-y-4">
      <PageHeader title="Marketplace" />
      <SimulatedBadge />
      <p className="text-sm text-muted-foreground">This workspace arrives in packet F-UI-11.</p>
    </div>
  );
}
