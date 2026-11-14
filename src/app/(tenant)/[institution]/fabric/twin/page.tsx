import type { Metadata } from "next";
import { getTenantContext } from "@/lib/auth/context";
import { ErrorState } from "@/components/states";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { TwinWorkspace } from "@/modules/fabric/components/twin/twin-workspace";
import { getScenario } from "@/modules/fabric/simulator.queries";
import { applyScenario } from "@/modules/fabric/twin.mapping";
import { twinHasHistorical, twinOverlays, twinSnapshot } from "@/modules/fabric/twin.queries";
import { labSectionAnomalies } from "@/modules/fabric/lab.queries";
import { rankAttention } from "@/modules/fabric/lab";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";

export const metadata: Metadata = { title: "Digital twin" };

export default async function DigitalTwinPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { scenario: scenarioParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  let hasHistorical: boolean;
  let current: Awaited<ReturnType<typeof twinSnapshot>>;
  let historical: Awaited<ReturnType<typeof twinSnapshot>>;
  try {
    hasHistorical = await twinHasHistorical(ctx);
    [current, historical] = await Promise.all([
      twinSnapshot(ctx, "current"),
      hasHistorical ? twinSnapshot(ctx, "historical") : Promise.resolve(null),
    ]);
  } catch (error) {
    // A slow or failed read (e.g. a database statement timeout) degrades this page, not the whole app.
    console.error("digital twin load failed:", error instanceof Error ? error.message : error);
    return (
      <FabricPage title="Digital twin" ws="twin">
        <ErrorState description="The twin took too long to load. Refresh to try again." />
      </FabricPage>
    );
  }

  // ?scenario=<id> from the simulator's "Open in twin": scenario.manage, same as the simulator page itself.
  const scenarioId = uuid.safeParse(scenarioParam);
  // Section anomalies (0125) need the Analysis lab's access (insight.read + insight.review).
  const canLab = hasPermission(ctx, "insight.read") && hasPermission(ctx, "insight.review");
  // Optional layers: each one failing leaves the twin itself intact, just without that layer.
  const optional = <T,>(run: Promise<T>, fallback: T): Promise<T> =>
    run.catch((error) => {
      console.error("digital twin layer failed:", error instanceof Error ? error.message : error);
      return fallback;
    });
  const [overlays, saved, anomalies] = await Promise.all([
    current ? optional(twinOverlays(ctx, current), null) : Promise.resolve(null),
    current && scenarioId.success && hasPermission(ctx, "scenario.manage") ? optional(getScenario(ctx, scenarioId.data), null) : Promise.resolve(null),
    current && canLab ? optional(labSectionAnomalies(ctx), []) : Promise.resolve([]),
  ]);
  const attention =
    current && (canLab || hasPermission(ctx, "timetable.manage"))
      ? rankAttention(current.nodes, overlays?.conflicts ?? {}, anomalies)
      : null;
  const canExplain = canLab && isModuleEnabled(ctx, "ai_briefings") && isAiCapabilityEnabled(ctx, "lab_explain");
  const scenario =
    current && saved
      ? {
          name: saved.name,
          snapshot: applyScenario(
            current,
            { enrolmentDeltaPct: saved.assumptions.enrolment_delta_pct, staffDelta: saved.assumptions.staff_delta },
            saved.id,
          ),
        }
      : null;

  return (
    <FabricPage title="Digital twin" ws="twin">
      <TwinWorkspace
        base={`/${institutionSlug}`}
        current={current}
        historical={historical}
        hasHistorical={hasHistorical}
        scenario={scenario}
        scenarioRequested={scenarioParam !== undefined}
        overlays={overlays}
        attention={attention}
        institutionSlug={institutionSlug}
        canExplain={canExplain}
      />
    </FabricPage>
  );
}
