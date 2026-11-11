import "server-only";
// live-fabric lane "simulator" (F-UI-08): real-data loaders replacing
// src/modules/fabric/demo/simulator.ts's BASELINE_FACTS/scenarios() fixture
// (runScenario/sensitivity stay pure and are re-exported unchanged — they
// take BaselineFacts/ScenarioAssumptions, not a data source, so nothing
// about them changes). Cross-module reads go through the owner's
// queries.ts (peopleCounts, collectionReport; simulatorSignals adds
// financeSeries, getAdmissionsFunnelCounts, timetableTeacherWorkload); rooms/periods have no
// owner query yet, so they're read directly here — the same
// cross-cutting-aggregate pattern src/modules/timetable/queries.ts already
// uses for the same two tables (timetableRoomUtilisation), both RLS'd to
// any active member (0069).
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { peopleCounts } from "@/modules/people/counts.queries";
import { collectionReport } from "@/modules/finance/queries";
import { financeSeries } from "@/modules/forecasts/queries";
import { getAdmissionsFunnelCounts, type AdmissionsFunnelCounts } from "@/modules/admissions/queries";
import { defaultPublishedVersionId, timetableTeacherWorkload } from "@/modules/timetable/queries";
import { BASELINE_FACTS, runScenario, sensitivity, type BaselineFacts } from "@/modules/fabric/demo/simulator";
import { ScenarioAssumptionsSchema } from "@/modules/fabric/simulator.schemas";
import type { FinanceForecastPoint, ScenarioAssumptions, ScenarioStatus } from "@/modules/fabric/types";

export { runScenario, sensitivity, type BaselineFacts };

// No cost data exists anywhere in the schema (live-fabric BRIEF, simulator
// lane ruling) — this ratio is an explicit, documented assumption, never
// presented as real. The UI must pair it with a LimitedBadge.
export const ASSUMED_COST_RATIO = 0.8; // of monthly revenue baseline

export interface RealBaselineFacts {
  facts: BaselineFacts;
  /** True for every field — callers show the LimitedBadge next to cost in the UI. */
  costIsAssumption: true;
}

/**
 * Real BASELINE_FACTS: enrolled students + staff (people.peopleCounts),
 * current academic year billed total ÷ students ÷ 12 as the average
 * monthly fee (finance.collectionReport, integer paise), non-break periods
 * as periods/day, and room count + average capacity (direct read, see
 * header). Cost has no real source (ASSUMED_COST_RATIO); if there are no
 * students or rooms yet, falls back to BASELINE_FACTS's fixture shape for
 * the fields that would otherwise divide by zero.
 */
export async function realBaselineFacts(ctx: TenantContext): Promise<RealBaselineFacts> {
  const supabase = await createClient();
  const [{ students, staff }, yearRows, roomsResult, periodsResult] = await Promise.all([
    peopleCounts(ctx),
    collectionReport(ctx, { groupBy: "term" }),
    supabase.from("rooms").select("capacity").eq("institution_id", ctx.institution.id),
    supabase
      .from("periods")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", ctx.institution.id)
      .eq("is_break", false),
  ]);
  if (roomsResult.error) throw roomsResult.error;
  if (periodsResult.error) throw periodsResult.error;

  const billedRupeesYear = yearRows.reduce((sum, row) => sum + (row.billed ?? 0), 0);
  const avgFeePaiseMonth =
    students > 0 ? Math.round((billedRupeesYear * 100) / students / 12) : BASELINE_FACTS.avg_fee_paise_month;

  const rooms = roomsResult.data?.length ?? 0;
  const totalCapacity = (roomsResult.data ?? []).reduce((sum, room) => sum + room.capacity, 0);
  const maxStudentsPerRoom = rooms > 0 ? Math.round(totalCapacity / rooms) : BASELINE_FACTS.max_students_per_room;

  const periodsPerDay = periodsResult.count && periodsResult.count > 0 ? periodsResult.count : BASELINE_FACTS.periods_per_day;

  const teachers = staff > 0 ? staff : BASELINE_FACTS.teachers;
  const revenuePaiseMonth = Math.round(avgFeePaiseMonth * (students > 0 ? students : BASELINE_FACTS.students));
  const costPaiseMonth = Math.round(revenuePaiseMonth * ASSUMED_COST_RATIO);

  return {
    facts: {
      students: students > 0 ? students : BASELINE_FACTS.students,
      avg_fee_paise_month: avgFeePaiseMonth,
      teachers,
      cost_paise_month: costPaiseMonth,
      rooms: rooms > 0 ? rooms : BASELINE_FACTS.rooms,
      periods_per_day: periodsPerDay,
      max_students_per_room: maxStudentsPerRoom,
    },
    costIsAssumption: true,
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * forecasts.financeSeries points -> "YYYY-MM" -> forecast fee collections in
 * rupees/month, for the simulator chart's Forecast line. Each forecast term
 * is spread evenly over the months until the next term starts (the last term
 * reuses the previous term's length; a lone term with no neighbour is
 * dropped — its length can't be inferred). History terms are skipped.
 */
export function forecastByMonth(points: FinanceForecastPoint[]): Record<string, number> {
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const out: Record<string, number> = {};
  sorted.forEach((p, i) => {
    // financeSeries' forecast rows carry collected 0 and a non-zero band; history rows have low = high = collected.
    if (p.collected_paise !== 0 || p.forecast_high_paise <= 0) return;
    const next = sorted[i + 1];
    const prev = sorted[i - 1];
    const span = next ? monthsBetween(p.month, next.month) : prev ? monthsBetween(prev.month, p.month) : 0;
    if (span <= 0) return;
    for (let m = 0; m < span; m++) out[addMonths(p.month, m)] = Math.round(p.expected_paise / span) / 100;
  });
  return out;
}

const ENROLMENT_DELTA_MAX_PCT = 30; // ScenarioAssumptionsSchema.enrolment_delta_pct max

/** Offered + accepted applications (not yet enrolled) as a whole-percent enrolment delta vs `students`, capped at the slider max; null when there's nothing to hint. */
export function pipelineEnrolmentHint(funnel: AdmissionsFunnelCounts, students: number): { pending: number; pct: number } | null {
  const pending = funnel.applicationStatuses.offered + funnel.applicationStatuses.accepted;
  if (pending === 0 || students <= 0) return null;
  return { pending, pct: Math.min(ENROLMENT_DELTA_MAX_PCT, Math.round((pending / students) * 100)) };
}

/** Mean periods/week across timetabled teachers, 1 decimal; null with none. */
export function avgTeacherPeriodsWeek(rows: { periods_week: number }[]): number | null {
  if (rows.length === 0) return null;
  return Math.round((rows.reduce((sum, r) => sum + r.periods_week, 0) / rows.length) * 10) / 10;
}

export interface SimulatorSignals {
  /** "YYYY-MM" -> forecast fee collections, rupees/month. Empty when no forecast is visible. */
  forecastByMonth: Record<string, number>;
  /** Admissions funnel counts for the enrolment hint (pipelineEnrolmentHint); null without admissions.enquiry.read. */
  funnel: AdmissionsFunnelCounts | null;
  /** Real teacher load from the published timetable; null without timetable.manage or a published version. */
  teacherLoad: { avgPeriodsWeek: number; maxPeriods: number } | null;
}

/** Real signals the simulator shows beside its model. Each read is skipped unless the caller holds that owner query's permission. */
export async function simulatorSignals(ctx: TenantContext): Promise<SimulatorSignals> {
  const [series, funnel, workload] = await Promise.all([
    hasPermission(ctx, "forecast.read") ? financeSeries(ctx) : [],
    hasPermission(ctx, "admissions.enquiry.read") ? getAdmissionsFunnelCounts(ctx) : null,
    hasPermission(ctx, "timetable.manage")
      ? defaultPublishedVersionId(ctx).then((versionId) => (versionId ? timetableTeacherWorkload(ctx, versionId) : []))
      : [],
  ]);
  const avgPeriodsWeek = avgTeacherPeriodsWeek(workload);
  return {
    forecastByMonth: forecastByMonth(series),
    funnel,
    teacherLoad: avgPeriodsWeek == null ? null : { avgPeriodsWeek, maxPeriods: workload[0]!.max_periods },
  };
}

export interface SavedScenario {
  id: string;
  name: string;
  rationale: string;
  status: ScenarioStatus;
  assumptions: ScenarioAssumptions;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returns `null` when `assumptions` doesn't match `ScenarioAssumptionsSchema` — caller skips the row. */
function mapScenarioRow(row: Record<string, unknown>): SavedScenario | null {
  const parsed = ScenarioAssumptionsSchema.safeParse(row.assumptions);
  if (!parsed.success) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    rationale: row.rationale as string,
    status: row.status as ScenarioStatus,
    assumptions: parsed.data as ScenarioAssumptions,
    createdBy: row.created_by as string,
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const SCENARIO_COLUMNS = "id, name, rationale, status, assumptions, created_by, decided_by, decided_at, created_at, updated_at";

/** Saved scenarios for the institution, newest first — replaces the demo/simulator.ts SAVED_SCENARIOS fixture as the source of truth. */
export async function listScenarios(ctx: TenantContext): Promise<SavedScenario[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("simulation_scenarios")
    .select(SCENARIO_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapScenarioRow).filter((row): row is SavedScenario => row !== null);
}

/** A single saved scenario, or null if it doesn't exist / isn't visible to the caller (RLS) / has invalid assumptions. */
export async function getScenario(ctx: TenantContext, id: string): Promise<SavedScenario | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("simulation_scenarios")
    .select(SCENARIO_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapScenarioRow(data) : null;
}

