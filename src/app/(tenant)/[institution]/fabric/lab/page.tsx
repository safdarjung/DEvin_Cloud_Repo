import type { Metadata } from "next";
// features-18 §D — Analysis lab. Four school-wide analyses computed in SQL
// (0125: aggregates only, groups < 5 students dropped), shown as charts +
// tables with deterministic captions; AI only narrates on request.
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { LabPanels } from "@/modules/fabric/components/lab/lab-panels";
import { labCorrelation, labFeeRiskCohorts, labSectionAnomalies, labTrendBreaks, requireLabAccess } from "@/modules/fabric/lab.queries";

export const metadata: Metadata = { title: "Analysis lab" };

const settledOrNull = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

const DESCRIPTION = "Patterns across sections, subjects and grades. Numbers are computed by fixed rules from groups of 5 or more students; AI only explains them.";

export default async function AnalysisLabPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireLabAccess(ctx);

  if (!isModuleEnabled(ctx, "insights")) {
    return (
      <FabricPage title="Analysis lab" description={DESCRIPTION} ws="lab">
        <EmptyState
          title="Insights are turned off"
          description="Enable the Insights module in Settings, Modules to use the Analysis lab."
          action={
            hasPermission(ctx, "institution.settings.manage") ? (
              <Button asChild variant="outline">
                <Link href={`/${slug}/settings/modules`}>Open module settings</Link>
              </Button>
            ) : undefined
          }
        />
      </FabricPage>
    );
  }

  // Panels load independently: one failed or timed-out analysis shows its own error, not a blank page.
  const [correlation, anomalies, feeRisk, trends] = await Promise.allSettled([
    labCorrelation(ctx),
    labSectionAnomalies(ctx),
    labFeeRiskCohorts(ctx),
    labTrendBreaks(ctx),
  ]);
  for (const r of [correlation, anomalies, feeRisk, trends]) {
    if (r.status === "rejected") console.error("analysis lab panel failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  const canExplain = isModuleEnabled(ctx, "ai_briefings") && isAiCapabilityEnabled(ctx, "lab_explain");

  return (
    <FabricPage title="Analysis lab" description={DESCRIPTION} ws="lab">
      <LabPanels
        institutionSlug={slug}
        canExplain={canExplain}
        correlation={settledOrNull(correlation)}
        anomalies={settledOrNull(anomalies)}
        feeRisk={settledOrNull(feeRisk)}
        trends={settledOrNull(trends)}
      />
    </FabricPage>
  );
}
