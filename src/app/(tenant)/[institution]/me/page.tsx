import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { FadeIn } from "@/components/motion";

export default async function PersonalAIPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.generate");

  // Unlinked placeholder: a settled empty state instead of an endless skeleton.
  return (
    <FabricPage title="Personal AI" ws="me">
      <FadeIn>
        <EmptyState title="Personal AI is not available yet" description="This workspace arrives in packet F-UI-13." />
      </FadeIn>
    </FabricPage>
  );
}
