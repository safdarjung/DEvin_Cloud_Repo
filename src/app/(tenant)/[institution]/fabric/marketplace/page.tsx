import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { Catalogue } from "@/modules/fabric/components/marketplace/catalogue";
import { marketplaceCatalog } from "@/modules/fabric/marketplace.queries";

export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const categories = marketplaceCatalog(ctx);
  const canManage = ctx.permissions.has("institution.settings.manage");

  return (
    <FabricPage title="Marketplace" ws="marketplace">
      <Catalogue institutionSlug={institutionSlug} categories={categories} canManage={canManage} />
    </FabricPage>
  );
}
