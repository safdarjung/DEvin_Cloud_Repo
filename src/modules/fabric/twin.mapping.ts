// F-UI-09 — pure digital-twin snapshot builder: real rows (from
// twin.queries.ts) -> the TwinSnapshot/TwinNode/TwinEdge shapes
// (src/modules/fabric/types.ts), the same contract src/modules/fabric/
// demo/twin.ts's fixture produced. No Supabase here, so this half is
// plain-unit-testable (CLAUDE.md "unit tests for mapping/pure logic").
// `changeImpact` from demo/twin.ts is reused unchanged (lane brief).
import type { InsightSeverity, ISODate, TimetableConflict, TwinEdge, TwinNode, TwinSnapshot } from "@/modules/fabric/types";

export interface SectionRow {
  id: string;
  label: string;
  /** null when settings.academic.section_capacity isn't configured for this section. */
  capacity: number | null;
  enrolled: number;
}
export interface RoomRow {
  id: string;
  name: string;
  /** Periods/week the bell schedule offers this room (working days x non-break periods) — not seating capacity. */
  periodsTotal: number;
  periodsUsed: number;
}
export interface TeacherRow {
  id: string;
  name: string;
  periodsWeek: number;
  maxPeriods: number;
}
export interface RouteRow {
  id: string;
  name: string;
  capacity: number;
  assigned: number;
}
export interface SlotRow {
  teacherId: string;
  sectionId: string;
  roomId: string | null;
}
export interface RouteAssignmentRow {
  routeId: string;
  sectionId: string;
}

export interface TwinSnapshotInput {
  id: string;
  institutionId: string;
  asOf: ISODate;
  state: "current" | "historical";
  sections: SectionRow[];
  rooms: RoomRow[];
  teachers: TeacherRow[];
  routes: RouteRow[];
  slots: SlotRow[];
  routeAssignments: RouteAssignmentRow[];
}

const COL_X = { student_group: 0, teacher: 220, room: 440, route: 660 } as const;
const ROW_Y = 90;

function utilisationPct(load: number, capacity: number): number {
  return capacity > 0 ? Math.round((load / capacity) * 100) : 0;
}

/** Packet's utilisation colour scale: ≤80 ok, ≤100 watch, >100 critical. */
export function utilisationTier(pct: number): "ok" | "watch" | "critical" {
  if (pct > 100) return "critical";
  if (pct > 80) return "watch";
  return "ok";
}

/**
 * Real twinSnapshot builder. Only 4 node types are populated — student_group,
 * teacher, room, route — because those are the only ones an owner module can
 * back with real capacity/load today; building/department/vehicle/workflow/
 * budget_line nodes (demo/twin.ts's fixture has them) are omitted rather than
 * invented (rule 7).
 */
export function buildTwinSnapshot(input: TwinSnapshotInput): TwinSnapshot {
  const nodes: TwinNode[] = [];

  input.sections.forEach((s, i) => {
    // No capacity configured: fall back to current size (utilisation reads
    // 100%, which honestly says "no defined cap" rather than inventing one).
    const capacity = s.capacity ?? s.enrolled;
    nodes.push({
      id: s.id,
      type: "student_group",
      label: s.label,
      capacity,
      load: s.enrolled,
      utilisation_pct: utilisationPct(s.enrolled, capacity),
      x: COL_X.student_group,
      y: i * ROW_Y,
    });
  });

  input.teachers.forEach((t, i) => {
    nodes.push({
      id: t.id,
      type: "teacher",
      label: t.name,
      capacity: t.maxPeriods,
      load: t.periodsWeek,
      utilisation_pct: utilisationPct(t.periodsWeek, t.maxPeriods),
      x: COL_X.teacher,
      y: i * ROW_Y,
    });
  });

  input.rooms.forEach((r, i) => {
    nodes.push({
      id: r.id,
      type: "room",
      label: r.name,
      capacity: r.periodsTotal,
      load: r.periodsUsed,
      utilisation_pct: utilisationPct(r.periodsUsed, r.periodsTotal),
      x: COL_X.room,
      y: i * ROW_Y,
    });
  });

  input.routes.forEach((route, i) => {
    nodes.push({
      id: route.id,
      type: "route",
      label: route.name,
      capacity: route.capacity,
      load: route.assigned,
      utilisation_pct: utilisationPct(route.assigned, route.capacity),
      x: COL_X.route,
      y: i * ROW_Y,
    });
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: TwinEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, relation: TwinEdge["relation"]): void => {
    const key = `${relation}:${source}->${target}`;
    if (!nodeIds.has(source) || !nodeIds.has(target) || seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, relation });
  };

  for (const slot of input.slots) {
    addEdge(slot.teacherId, slot.sectionId, "teaches");
    if (slot.roomId) addEdge(slot.sectionId, slot.roomId, "uses");
  }
  for (const a of input.routeAssignments) {
    addEdge(a.routeId, a.sectionId, "transports");
  }

  return {
    id: input.id,
    institution_id: input.institutionId,
    created_at: input.asOf,
    updated_at: input.asOf,
    as_of: input.asOf,
    state: input.state,
    scenario_id: null,
    nodes,
    edges,
  };
}

/**
 * Scenario view: `current` with a saved simulator scenario's deltas applied
 * linearly to node load — sections and routes scale with enrolment, teacher
 * periods spread over (teachers + staff delta, floored at 1). Rooms and
 * edges are unchanged: the scenario adds no sections or slots.
 */
export function applyScenario(
  current: TwinSnapshot,
  deltas: { enrolmentDeltaPct: number; staffDelta: number },
  scenarioId: string,
): TwinSnapshot {
  const enrolmentFactor = 1 + deltas.enrolmentDeltaPct / 100;
  const teachers = current.nodes.filter((n) => n.type === "teacher").length;
  const teacherFactor = teachers > 0 ? teachers / Math.max(1, teachers + deltas.staffDelta) : 1;
  const factorFor = (type: TwinNode["type"]): number =>
    type === "student_group" || type === "route" ? enrolmentFactor : type === "teacher" ? teacherFactor : 1;

  const nodes = current.nodes.map((n) => {
    const factor = factorFor(n.type);
    if (factor === 1 || n.load == null) return n;
    const load = Math.round(n.load * factor);
    return { ...n, load, utilisation_pct: utilisationPct(load, n.capacity ?? 0) };
  });
  return { ...current, state: "scenario", scenario_id: scenarioId, nodes };
}

export interface NodeConflicts {
  count: number;
  severity: InsightSeverity;
}

const CONFLICT_SEVERITY: Record<TimetableConflict["kind"], InsightSeverity> = {
  room_capacity: "critical",
  teacher_double_booked: "critical",
  room_double_booked: "critical",
  teacher_unavailable: "warning",
};
const SEVERITY_RANK: Record<InsightSeverity, number> = { info: 0, watch: 1, warning: 2, critical: 3 };

/**
 * timetableConflicts' rows -> per-node count + worst severity. Conflicts name
 * their entities by label (room name, "grade-section", teacher name), the
 * same labels buildTwinSnapshot gives those nodes.
 * shortcut: two nodes sharing a label both get the conflict; key by id if
 * timetableConflicts ever returns entity ids.
 */
export function conflictsByNode(nodes: TwinNode[], conflicts: TimetableConflict[]): Record<string, NodeConflicts> {
  const idsByLabel = new Map<string, string[]>();
  for (const n of nodes) idsByLabel.set(n.label, [...(idsByLabel.get(n.label) ?? []), n.id]);

  const out: Record<string, NodeConflicts> = {};
  for (const conflict of conflicts) {
    const severity = CONFLICT_SEVERITY[conflict.kind];
    for (const id of new Set(conflict.entities.flatMap((label) => idsByLabel.get(label) ?? []))) {
      const prev = out[id];
      out[id] = {
        count: (prev?.count ?? 0) + 1,
        severity: prev && SEVERITY_RANK[prev.severity] > SEVERITY_RANK[severity] ? prev.severity : severity,
      };
    }
  }
  return out;
}

/** Attendance % tier against settings.attendance.alert_thresholds — same comparisons as attendance's sectionsBelowThreshold. */
export function attendanceTier(pct: number, thresholds: { warn: number; critical: number }): "ok" | "watch" | "critical" {
  if (pct < thresholds.critical) return "critical";
  if (pct < thresholds.warn) return "watch";
  return "ok";
}
