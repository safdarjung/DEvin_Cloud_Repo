import "server-only";
// live-fabric lane "simulator" (F-UI-08): real-data loaders replacing
// src/modules/fabric/demo/simulator.ts's BASELINE_FACTS/scenarios() fixture
// (runScenario/sensitivity stay pure and are re-exported unchanged — they
// take BaselineFacts/ScenarioAssumptions, not a data source, so nothing
// about them changes). Cross-module reads go through the owner's
// queries.ts (peopleCounts, collectionReport); rooms/periods have no
// owner query yet, so they're read directly here — the same
// cross-cutting-aggregate pattern src/modules/timetable/queries.ts already
// uses for the same two tables (timetableRoomUtilisation), both RLS'd to
// any active member (0069).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { peopleCounts } from "@/modules/people/counts.queries";
import { collectionReport } from "@/modules/finance/queries";
import { BASELINE_FACTS, runScenario, sensitivity, type BaselineFacts } from "@/modules/fabric/demo/simulator";
import { ScenarioAssumptionsSchema } from "@/modules/fabric/simulator.schemas";
import type { ScenarioAssumptions, ScenarioStatus } from "@/modules/fabric/types";

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

