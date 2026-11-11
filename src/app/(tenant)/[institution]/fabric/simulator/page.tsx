import type { Metadata } from "next";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { EmptyState } from "@/components/states";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { Simulator } from "@/modules/fabric/components/simulator/simulator";
import { listScenarios, pipelineEnrolmentHint, realBaselineFacts, simulatorSignals } from "@/modules/fabric/simulator.queries";
import { feeForecastSpread } from "@/modules/fabric/lab.queries";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";

export const metadata: Metadata = { title: "Simulator" };

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

  const [baseline, scenarios, signals, spread] = await Promise.all([
    realBaselineFacts(ctx),
    listScenarios(ctx),
    simulatorSignals(ctx),
    feeForecastSpread(ctx),
  ]);
  if (!baseline) {
    return (
      <FabricPage title="Simulator" ws="simulator">
        <EmptyState title="Not enough data to simulate yet" description="The simulator needs enrolled students, staff, rooms and timetable periods. Add them and the baseline appears here." />
      </FabricPage>
    );
  }
  const { facts } = baseline;
  const enrolmentHint = signals.funnel ? pipelineEnrolmentHint(signals.funnel, facts.students) : null;
  const aiOn = isModuleEnabled(ctx, "ai_briefings");

  return (
    <FabricPage title="Simulator" ws="simulator">
      <Simulator
        institutionSlug={institutionSlug}
        role={ctx.membership.role}
        facts={facts}
        initialScenarios={scenarios}
        forecastByMonth={signals.forecastByMonth}
        enrolmentHint={enrolmentHint}
        teacherLoad={signals.teacherLoad}
        spread={spread}
        canAiScenario={aiOn && isAiCapabilityEnabled(ctx, "lab_scenario")}
        canExplain={aiOn && isAiCapabilityEnabled(ctx, "lab_explain")}
      />
    </FabricPage>
  );
}
