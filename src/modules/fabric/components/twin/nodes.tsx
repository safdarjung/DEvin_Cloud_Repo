"use client";
// F-UI-09 — one visual per TwinNodeType the real twinSnapshot populates
// (student_group, teacher, room, route; see twin.mapping.ts). Utilisation
// colour: ≤80 ok, ≤100 watch, >100 critical (packet), never colour alone —
// the tier label and the ring + a numeric caption carry the meaning too.
import { AlertTriangle, BusFront, DoorOpen, GraduationCap, Users, type LucideIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "cn";
import type { InsightSeverity, TwinNodeType } from "@/modules/fabric/types";
import { utilisationTier, type NodeConflicts } from "@/modules/fabric/twin.mapping";

// Impact-overlay ring colour, by changeImpact's severity (never colour alone — the drawer's affected list carries the same severity in text).
const IMPACT_RING: Record<InsightSeverity, string> = {
  info: "ring-info",
  watch: "ring-warning",
  warning: "ring-warning",
  critical: "ring-destructive",
};

const ICON: Record<TwinNodeType, LucideIcon> = {
  student_group: Users,
  teacher: GraduationCap,
  room: DoorOpen,
  route: BusFront,
  // Not populated by the real snapshot (no owner data yet) — kept for the TwinNodeType union only.
  department: Users,
  building: Users,
  vehicle: BusFront,
  workflow: Users,
  resource: Users,
  budget_line: Users,
};

const TIER_CLASS: Record<"ok" | "watch" | "critical", string> = {
  ok: "border-success/40 text-success",
  watch: "border-warning/50 text-warning",
  critical: "border-destructive/50 text-destructive",
};

export interface TwinNodeData extends Record<string, unknown> {
  label: string;
  nodeType: TwinNodeType;
  capacity?: number;
  load?: number;
  utilisation_pct?: number;
  /** Set only while "Show impact" is active for some other node (changeImpact's affected list). */
  impactSeverity?: InsightSeverity;
  /** Live timetable conflicts naming this node (current version only). */
  conflicts?: NodeConflicts;
  /** Section attendance % over the recent window, with its alert tier (student_group only). */
  attendance?: { pct: number; tier: "ok" | "watch" | "critical" };
}

const ATTENDANCE_TEXT: Record<"ok" | "watch" | "critical", string> = {
  ok: "text-success",
  watch: "text-warning",
  critical: "text-destructive",
};

function TwinFlowNode({ data }: NodeProps) {
  const d = data as TwinNodeData;
  const Icon = ICON[d.nodeType];
  const tier = d.utilisation_pct != null ? utilisationTier(d.utilisation_pct) : null;
  return (
    <div
      className={cn(
        "flex min-w-36 items-center gap-2 rounded-lg border-2 bg-card px-3 py-2 text-sm shadow-sm",
        tier ? TIER_CLASS[tier] : "border-border",
        d.impactSeverity && `motion-safe:animate-in motion-safe:fade-in ring-2 ring-offset-2 ${IMPACT_RING[d.impactSeverity]}`,
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <Icon className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{d.label}</p>
        {d.capacity != null && d.load != null && (
          <p className="text-xs text-muted-foreground">
            {d.load}/{d.capacity} · {tier === "ok" ? "OK" : tier === "watch" ? "Watch" : "Critical"} ({d.utilisation_pct}%)
          </p>
        )}
        {(d.attendance || d.conflicts) && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs">
            {d.attendance && <span className={ATTENDANCE_TEXT[d.attendance.tier]}>Attendance {d.attendance.pct}%</span>}
            {d.conflicts && (
              <span className={`inline-flex items-center gap-0.5 ${d.conflicts.severity === "critical" ? "text-destructive" : "text-warning"}`}>
                <AlertTriangle className="size-3" aria-hidden />
                {d.conflicts.count} conflict{d.conflicts.count === 1 ? "" : "s"}
              </span>
            )}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}

export const twinNodeTypes = {
  student_group: TwinFlowNode,
  teacher: TwinFlowNode,
  room: TwinFlowNode,
  route: TwinFlowNode,
};
