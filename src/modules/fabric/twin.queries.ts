import "server-only";
// F-UI-09 — src/modules/fabric/demo/twin.ts's twinSnapshot fixture
// replacement: real grades/sections, rooms, teachers and transport routes
// from owner queries/tables. `changeImpact` stays the fixture's pure
// function (lane brief) — only the snapshot source changes. RLS on every
// table read here (0069 timetable, 0075 operations) already narrows rows
// per role; the institution_id filters below are defense in depth, same
// shape as every other queries.ts in this codebase.
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import type { TwinSnapshot } from "@/modules/fabric/types";
import {
  attendanceTier,
  buildTwinSnapshot,
  conflictsByNode,
  type NodeConflicts,
  type RoomRow,
  type RouteAssignmentRow,
  type SlotRow,
} from "@/modules/fabric/twin.mapping";
import { attendanceDailyCounts, getAttendanceSettings, percentageFromCounts, todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { defaultPublishedVersionId, timetableConflicts, timetableTeacherWorkload } from "@/modules/timetable/queries";
import { transportRoutes } from "@/modules/transport/queries";

export type TwinState = "current" | "historical";

/**
 * Historical = the most recently archived timetable version (the prior
 * term/version `timetable_versions_select`'s RLS archives on publish).
 * Non-leadership roles can't read archived versions at all (0069 policy),
 * so this — and `twinSnapshot(ctx, "historical")` — correctly comes back
 * false/empty for them rather than leaking a prior term's numbers; the page
 * hides the Historical toggle option whenever this is false (lane brief).
 */
export async function twinHasHistorical(ctx: TenantContext): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("timetable_versions")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("status", "archived");
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function resolveVersionId(ctx: TenantContext, state: TwinState): Promise<string | null> {
  if (state === "current") return defaultPublishedVersionId(ctx);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "archived")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Every room's load against the bell schedule for `versionId` — mirrors
 * timetable.queries.ts's timetableRoomUtilisation, kept separate only
 * because that function drops room id (fine for its own fixture-shaped
 * callers, not usable as a graph node key here).
 */
async function roomLoadById(ctx: TenantContext, versionId: string): Promise<RoomRow[]> {
  const supabase = await createClient();
  const [{ data: rooms, error: roomsError }, { count: nonBreakCount, error: periodsError }, { data: slotRows, error: slotsError }] =
    await Promise.all([
      supabase.from("rooms").select("id, name, capacity").eq("institution_id", ctx.institution.id),
      supabase.from("periods").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).eq("is_break", false),
      supabase.from("timetable_slots").select("room_id, weekday").eq("institution_id", ctx.institution.id).eq("version_id", versionId).not("room_id", "is", null),
    ]);
  if (roomsError) throw roomsError;
  if (periodsError) throw periodsError;
  if (slotsError) throw slotsError;

  // Working days = weekdays this version actually schedules (weekday is 1..6 by 0069's check); 6 before any room slot exists.
  const workingDays = new Set((slotRows ?? []).map((row) => row.weekday)).size || 6;
  const periodsTotal = workingDays * (nonBreakCount ?? 0);
  const usedByRoom = new Map<string, number>();
  for (const row of slotRows ?? []) {
    if (!row.room_id) continue;
    usedByRoom.set(row.room_id, (usedByRoom.get(row.room_id) ?? 0) + 1);
  }
  return (rooms ?? []).map((room) => ({ id: room.id, name: room.name, periodsTotal, periodsUsed: usedByRoom.get(room.id) ?? 0 }));
}

/** Every active enrolment's section, grouped — section label and headcount for the student_group nodes. */
async function sectionLoad(ctx: TenantContext): Promise<{ id: string; label: string; capacity: number | null; enrolled: number }[]> {
  const supabase = await createClient();
  const [{ data: sections, error: sectionsError }, { data: enrolments, error: enrolError }] = await Promise.all([
    supabase.from("class_sections").select("id, name, capacity, grades(code)").eq("institution_id", ctx.institution.id),
    supabase.from("enrolments").select("student_id, class_section_id").eq("institution_id", ctx.institution.id).eq("status", "active"),
  ]);
  if (sectionsError) throw sectionsError;
  if (enrolError) throw enrolError;

  const enrolledBySection = new Map<string, number>();
  for (const e of enrolments ?? []) {
    enrolledBySection.set(e.class_section_id, (enrolledBySection.get(e.class_section_id) ?? 0) + 1);
  }
  return (sections ?? []).map((s) => {
    const grade = s.grades as { code: string } | null;
    return { id: s.id, label: `${grade?.code ?? "?"}-${s.name}`, capacity: s.capacity, enrolled: enrolledBySection.get(s.id) ?? 0 };
  });
}

/** teaches/uses edges — the version's slots (teacher, section, room). */
async function slotEdges(ctx: TenantContext, versionId: string): Promise<SlotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_slots")
    .select("teacher_id, class_section_id, room_id")
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ teacherId: r.teacher_id, sectionId: r.class_section_id, roomId: r.room_id }));
}

/** transports edges — each assigned student's active section, via their route. Not version-scoped: transport isn't part of the timetable. */
async function routeSectionEdges(ctx: TenantContext): Promise<RouteAssignmentRow[]> {
  const supabase = await createClient();
  const { data: assignments, error: assignError } = await supabase
    .from("transport_assignments")
    .select("route_id, student_id")
    .eq("institution_id", ctx.institution.id);
  if (assignError) throw assignError;
  const rows = assignments ?? [];
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .in("student_id", studentIds);
  if (enrolError) throw enrolError;
  const sectionByStudent = new Map((enrolments ?? []).map((e) => [e.student_id, e.class_section_id]));

  const seen = new Set<string>();
  const out: RouteAssignmentRow[] = [];
  for (const row of rows) {
    const sectionId = sectionByStudent.get(row.student_id);
    if (!sectionId) continue;
    const key = `${row.route_id}->${sectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ routeId: row.route_id, sectionId });
  }
  return out;
}

/**
 * Real digital-twin snapshot: grades/sections, rooms, teachers, transport
 * routes from owner queries (lane brief F-UI-09). Returns null when there's
 * no timetable version to build `state` from (no published version yet, or
 * — for "historical" — no archived one / RLS hides it): the page shows
 * LimitedBadge rather than an empty graph claiming to be real. Scenario
 * state is the current snapshot through twin.mapping's applyScenario (page).
 */
export async function twinSnapshot(ctx: TenantContext, state: TwinState): Promise<TwinSnapshot | null> {
  const versionId = await resolveVersionId(ctx, state);
  if (!versionId) return null;

  const [sections, rooms, teachers, routes, slots, routeAssignments] = await Promise.all([
    sectionLoad(ctx),
    roomLoadById(ctx, versionId),
    timetableTeacherWorkload(ctx, versionId),
    transportRoutes(ctx),
    slotEdges(ctx, versionId),
    routeSectionEdges(ctx),
  ]);

  return buildTwinSnapshot({
    id: versionId,
    institutionId: ctx.institution.id,
    asOf: new Date().toISOString(),
    state,
    sections,
    rooms,
    teachers: teachers.map((t) => ({ id: t.staff_id, name: t.name, periodsWeek: t.periods_week, maxPeriods: t.max_periods })),
    routes: routes.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, assigned: r.assigned })),
    slots,
    routeAssignments,
  });
}

export interface TwinOverlays {
  /** Current-version timetable conflicts by node id; empty without timetable.manage. */
  conflicts: Record<string, NodeConflicts>;
  /** Section id -> attendance % over the last ATTENDANCE_HEAT_DAYS days and its alert tier; empty without attendance.read. */
  attendance: Record<string, { pct: number; tier: "ok" | "watch" | "critical" }>;
}

const ATTENDANCE_HEAT_DAYS = 14;

/** Per-section attendance % over the window — one by-section attendance_daily_counts call (not attendanceTrend per section). */
async function sectionAttendance(ctx: TenantContext): Promise<TwinOverlays["attendance"]> {
  const settings = getAttendanceSettings(ctx);
  const to = todayInInstitutionTimezone(ctx);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (ATTENDANCE_HEAT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await attendanceDailyCounts(ctx, { from, to, bySection: true });

  const bySection = new Map<string, { status: string; n: number }[]>();
  for (const row of rows) {
    if (!row.classSectionId) continue;
    bySection.set(row.classSectionId, [...(bySection.get(row.classSectionId) ?? []), { status: row.status, n: row.n }]);
  }
  const out: TwinOverlays["attendance"] = {};
  for (const [sectionId, counts] of bySection) {
    const { percentage, totalInDenominator } = percentageFromCounts(counts, settings.statuses);
    if (totalInDenominator === 0) continue;
    out[sectionId] = { pct: Math.round(percentage), tier: attendanceTier(percentage, settings.thresholds) };
  }
  return out;
}

/** Live overlays for the current snapshot (its id is the published version id). Each read is skipped unless the caller holds that owner query's permission. */
export async function twinOverlays(ctx: TenantContext, current: TwinSnapshot): Promise<TwinOverlays> {
  const [conflicts, attendance] = await Promise.all([
    hasPermission(ctx, "timetable.manage") ? timetableConflicts(ctx, current.id) : [],
    hasPermission(ctx, "attendance.read") ? sectionAttendance(ctx) : {},
  ]);
  return { conflicts: conflictsByNode(current.nodes, conflicts), attendance };
}
