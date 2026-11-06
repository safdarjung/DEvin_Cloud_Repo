// F-UI-09 — pure digital-twin snapshot builder: real rows (from
// twin.queries.ts) -> the TwinSnapshot/TwinNode/TwinEdge shapes
// (src/modules/fabric/types.ts), the same contract src/modules/fabric/
// demo/twin.ts's fixture produced. No Supabase here, so this half is
// plain-unit-testable (CLAUDE.md "unit tests for mapping/pure logic").
// `changeImpact` from demo/twin.ts is reused unchanged (lane brief).
import type { ISODate, TwinEdge, TwinNode, TwinSnapshot } from "@/modules/fabric/types";

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
  /** Periods/week the bell schedule offers this room (6 x non-break periods) — not seating capacity. */
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
