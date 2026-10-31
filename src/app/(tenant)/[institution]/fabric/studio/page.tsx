import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { WorkspaceSkeleton } from "@/modules/fabric/components/workspace-skeleton";

export default async function CustomStudioPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  return (
    <FabricPage title="Custom Studio" ws="studio">
      <WorkspaceSkeleton packet="F-UI-12" />
    </FabricPage>
  );
}
