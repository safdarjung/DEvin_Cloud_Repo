import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { WorkspaceSkeleton } from "@/modules/fabric/components/workspace-skeleton";

export default async function PersonalAIPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.generate");

  return (
    <FabricPage title="Personal AI" ws="me">
      <WorkspaceSkeleton packet="F-UI-13" />
    </FabricPage>
  );
}
