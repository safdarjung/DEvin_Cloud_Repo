"use client";
// F-UI-09 — Historical/Current/Scenario segmented control. Historical only
// appears when `hasHistorical` (an archived timetable version this caller can
// read, twin.queries.ts's twinHasHistorical) is true; Scenario only when the
// page loaded a saved simulator scenario (?scenario=<id>). Scenario loads are
// a linear projection (twin.mapping's applyScenario), so it carries the
// LimitedBadge (rule 7).
import { LimitedBadge } from "@/components/honesty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TwinState } from "@/modules/fabric/twin.queries";

export type TwinView = TwinState | "scenario";

export function TwinStateToggle({
  state,
  hasHistorical,
  scenarioName,
  scenarioRequested,
  onChange,
}: {
  state: TwinView;
  hasHistorical: boolean;
  /** Loaded saved scenario's name, or null. */
  scenarioName: string | null;
  /** True when ?scenario= was in the URL, loaded or not. */
  scenarioRequested: boolean;
  onChange: (state: TwinView) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Tabs value={state} onValueChange={(v) => onChange(v as TwinView)}>
        <TabsList>
          <TabsTrigger value="current">Current</TabsTrigger>
          {hasHistorical && <TabsTrigger value="historical">Historical</TabsTrigger>}
          {scenarioName && <TabsTrigger value="scenario">Scenario</TabsTrigger>}
        </TabsList>
      </Tabs>
      {scenarioName ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LimitedBadge />
          {scenarioName}: enrolment and staff changes applied linearly to current load
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {scenarioRequested ? "That saved scenario wasn't found or isn't visible to you." : "Open a saved scenario from the simulator to project it here."}
        </span>
      )}
    </div>
  );
}
