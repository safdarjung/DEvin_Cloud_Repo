import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { Simulator } from "@/modules/fabric/components/simulator/simulator";
import { listScenarios, realBaselineFacts } from "@/modules/fabric/simulator.queries";

export default async function SimulatorPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  // Leadership-only (owner/principal/admin) — F-UI-08 packet + live-fabric
  // BRIEF ("keep the page guard sensible... leadership-only where the
  // packet says principal/owner"). Approve/reject is further restricted to
  // owner/principal inside fabric.simulator.decide.
  requirePermission(ctx, "scenario.manage");

  const [{ facts }, scenarios] = await Promise.all([realBaselineFacts(ctx), listScenarios(ctx)]);

  return (
    <FabricPage title="Simulator" ws="simulator">
      <Simulator institutionSlug={institutionSlug} role={ctx.membership.role} facts={facts} initialScenarios={scenarios} />
    </FabricPage>
  );
}
