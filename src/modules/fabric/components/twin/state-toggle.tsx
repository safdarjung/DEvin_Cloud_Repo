"use client";
// F-UI-09 — Historical/Current segmented control. Historical only appears
// when `hasHistorical` (an archived timetable version this caller can read,
// twin.queries.ts's twinHasHistorical) is true. Scenario isn't a toggle
// option at all on this base: the simulator lane's saved-scenario table
// (0106) doesn't exist yet, so it's named here only via the LimitedBadge,
// never offered as a clickable state (lane brief, rule 7).
import { LimitedBadge } from "@/components/honesty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TwinState } from "@/modules/fabric/twin.queries";

export function TwinStateToggle({
  state,
  hasHistorical,
  onChange,
}: {
  state: TwinState;
  hasHistorical: boolean;
  onChange: (state: TwinState) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Tabs value={state} onValueChange={(v) => onChange(v as TwinState)}>
        <TabsList>
          <TabsTrigger value="current">Current</TabsTrigger>
          {hasHistorical && <TabsTrigger value="historical">Historical</TabsTrigger>}
        </TabsList>
      </Tabs>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <LimitedBadge />
        Scenario needs a saved simulator scenario, not available yet
      </span>
    </div>
  );
}
