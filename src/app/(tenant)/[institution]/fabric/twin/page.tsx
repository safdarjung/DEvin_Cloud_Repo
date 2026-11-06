import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { TwinWorkspace } from "@/modules/fabric/components/twin/twin-workspace";
import { twinHasHistorical, twinSnapshot } from "@/modules/fabric/twin.queries";

export default async function DigitalTwinPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const hasHistorical = await twinHasHistorical(ctx);
  const [current, historical] = await Promise.all([
    twinSnapshot(ctx, "current"),
    hasHistorical ? twinSnapshot(ctx, "historical") : Promise.resolve(null),
  ]);

  return (
    <FabricPage title="Digital twin" ws="twin">
      <TwinWorkspace base={`/${institutionSlug}`} current={current} historical={historical} hasHistorical={hasHistorical} />
    </FabricPage>
  );
}
