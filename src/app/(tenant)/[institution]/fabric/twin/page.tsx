import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { demoFixturesEnabled } from "@/modules/core/demo/fixtures";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { PlannedWorkspace } from "@/modules/fabric/components/planned-workspace";

export default async function DigitalTwinPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  return (
    <FabricPage title="Digital twin" ws="twin">
      <PlannedWorkspace demo={demoFixturesEnabled(ctx)} packet="F-UI-09" name="Digital twin" base={`/${institutionSlug}`} />
    </FabricPage>
  );
}
