"use client";
// F-UI-08 what-if simulator — three-column layout (Assumptions · Results ·
// Scenarios). runScenario/sensitivity are pure and local (demo/simulator.ts,
// unchanged): every slider move recomputes instantly, no server round-trip.
// `facts` is real (BASELINE_FACTS/simulator.queries.realBaselineFacts),
// except cost (no cost data exists anywhere in the schema — flagged below).
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LimitedBadge } from "@/components/honesty";
import { inr } from "@/lib/format";
import type { Role } from "@/lib/auth/permissions";
import { runScenario, sensitivity, type BaselineFacts } from "@/modules/fabric/demo/simulator";
import type { SavedScenario } from "@/modules/fabric/simulator.queries";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import { downloadFile, toCsv } from "@/modules/fabric/components/download";
import { AssumptionsPanel, baselineAssumptions } from "./assumptions-panel";
import { ResultsPanel } from "./results-panel";
import { ScenarioList } from "./scenario-list";

export function Simulator({
  institutionSlug,
  role,
  facts,
  initialScenarios,
}: {
  institutionSlug: string;
  role: Role;
  facts: BaselineFacts;
  initialScenarios: SavedScenario[];
}) {
  const baseline = useMemo(() => baselineAssumptions(facts), [facts]);
  const [assumptions, setAssumptions] = useState<ScenarioAssumptions>(baseline);
  const [activeId, setActiveId] = useState<string | null>(null);

  const scenarioResults = useMemo(() => runScenario(assumptions, facts), [assumptions, facts]);
  const baselineResults = useMemo(() => runScenario(baseline, facts), [baseline, facts]);
  const sensitivityRows = useMemo(() => sensitivity(assumptions, facts), [assumptions, facts]);

  function handleLoad(scenario: SavedScenario) {
    setAssumptions(scenario.assumptions);
    setActiveId(scenario.id);
  }

  function exportCsv() {
    const rows = scenarioResults.months.map((month, i) => ({
      month,
      revenue_rupees: (scenarioResults.revenue_paise[i] ?? 0) / 100,
      cost_rupees: (scenarioResults.cost_paise[i] ?? 0) / 100,
      capacity_utilisation_pct: scenarioResults.capacity_utilisation_pct[i],
      teacher_load_hours: scenarioResults.teacher_load_hours[i],
    }));
    downloadFile(`simulator-scenario-${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LimitedBadge /> Cost baseline ({inr(facts.cost_paise_month / 100)}/month) is an assumption, not real cost data — no cost
          records exist yet.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-4" aria-hidden /> Export CSV
          </Button>
          {activeId && (
            <Link
              href={`/${institutionSlug}/fabric/twin?scenario=${activeId}`}
              className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-accent"
            >
              Open in twin
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]">
        <details className="rounded-lg border p-3 lg:border-none lg:p-0" open>
          <summary className="cursor-pointer text-sm font-medium lg:hidden">Assumptions</summary>
          <div className="mt-3 lg:mt-0">
            <AssumptionsPanel assumptions={assumptions} baseline={baseline} onChange={setAssumptions} />
          </div>
        </details>

        <div>
          <ResultsPanel scenario={scenarioResults} baseline={baselineResults} sensitivity={sensitivityRows} />
        </div>

        <div>
          <ScenarioList
            institutionSlug={institutionSlug}
            scenarios={initialScenarios}
            currentAssumptions={assumptions}
            activeId={activeId}
            role={role}
            facts={facts}
            onLoad={handleLoad}
          />
        </div>
      </div>
    </div>
  );
}
