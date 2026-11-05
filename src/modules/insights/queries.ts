import "server-only";
// M19-T18 — insights.list / insights.actions. RLS (0092) already narrows
// visibility (owner/principal/admin: all; admissions/accountant/
// exam_controller: their domain; teacher: attendance/academics of taught
// sections); the institution_id filter below is defense in depth, same
// shape as every other queries.ts in this codebase. Mirrors
// src/modules/timetable/queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { Insight, InsightAction, InsightExplanation } from "@/modules/fabric/types";
import type { Database } from "@/lib/db/types";
import type { ListInsightsInput } from "./schemas";

type InsightRow = Database["public"]["Tables"]["insights"]["Row"];
type InsightActionRow = Database["public"]["Tables"]["insight_actions"]["Row"];

function toExplanation(row: InsightRow): InsightExplanation | null {
  if (!row.explanation) return null;
  // set_insight_explanation (T3) only ever writes explanation together with
  // explanation_provider/explanation_model/explained_at, so all four are
  // present whenever `explanation` is non-null.
  const e = row.explanation as unknown as { what: string; why: string; next_steps: string[] };
  return {
    what: e.what,
    why: e.why,
    next_steps: e.next_steps,
    provider: row.explanation_provider as "local" | "cloud",
    model: row.explanation_model ?? "",
    explained_at: row.explained_at ?? "",
  };
}

function toEntityRef(
  row: InsightRow,
  studentNameById: Map<string, string>,
  staffNameById: Map<string, string>,
): Insight["entity_ref"] {
  if (!row.entity_type || !row.entity_id) return null;
  const type = row.entity_type as "section" | "student" | "staff" | "route" | "fee_structure" | "department";
  let label = row.entity_label ?? "";
  if (type === "student") label = studentNameById.get(row.entity_id) ?? "Student";
  else if (type === "staff") label = staffNameById.get(row.entity_id) ?? "Staff member";
  return { type, id: row.entity_id, label };
}

function toInsight(
  row: InsightRow,
  studentNameById: Map<string, string>,
  staffNameById: Map<string, string>,
): Insight {
  return {
    id: row.id,
    institution_id: row.institution_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    title: row.title,
    domain: row.domain as Insight["domain"],
    severity: row.severity as Insight["severity"],
    kind: row.kind as Insight["kind"],
    pattern: row.pattern,
    evidence: row.evidence as unknown as Insight["evidence"],
    sources: row.sources,
    date_from: row.date_from,
    date_to: row.date_to,
    confidence: row.confidence,
    factors: row.factors as unknown as Insight["factors"],
    reviewer_role: row.reviewer_role,
    recommended_actions: row.recommended_actions,
    approval_required: row.approval_required,
    status: row.status as Insight["status"],
    entity_ref: toEntityRef(row, studentNameById, staffNameById),
    signal: row.signal,
    detector_version: row.detector_version,
    explanation: toExplanation(row),
  };
}

function toInsightAction(row: InsightActionRow): InsightAction {
  return {
    id: row.id,
    institution_id: row.institution_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    insight_id: row.insight_id,
    action: row.action,
    owner: row.owner,
    rationale: row.rationale,
    expected_outcome: row.expected_outcome,
    actual_outcome: row.actual_outcome,
    decided_at: row.decided_at,
    measured_at: row.measured_at,
    status: row.status as InsightAction["status"],
  };
}

/**
 * Filtered, `created_at desc` insights for the caller's institution, with
 * student/staff entity labels resolved in one batched read per entity type
 * (under the caller's own RLS — a name the caller cannot read falls back to
 * "Student"/"Staff member", rulings `Insight` mapping).
 */
export async function listInsights(ctx: TenantContext, input: ListInsightsInput): Promise<Insight[]> {
  const supabase = await createClient();
  let query = supabase
    .from("insights")
    .select("*")
    .eq("institution_id", ctx.institution.id)
    .in("status", input.status)
    .order("created_at", { ascending: false })
    .limit(input.limit);
  if (input.domain) query = query.eq("domain", input.domain);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.filter((r) => r.entity_type === "student" && r.entity_id).map((r) => r.entity_id as string))];
  const staffIds = [...new Set(rows.filter((r) => r.entity_type === "staff" && r.entity_id).map((r) => r.entity_id as string))];

  const studentNameById = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id, first_name, last_name")
      .in("id", studentIds);
    if (studentsError) throw studentsError;
    for (const s of students ?? []) studentNameById.set(s.id, [s.first_name, s.last_name].filter(Boolean).join(" "));
  }

  const staffNameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase.from("staff").select("id, full_name").in("id", staffIds);
    if (staffError) throw staffError;
    for (const s of staffRows ?? []) staffNameById.set(s.id, s.full_name);
  }

  return rows.map((row) => toInsight(row, studentNameById, staffNameById));
}

/**
 * Current actions for one insight (`decided_at` asc). "Current" = a row no
 * other row supersedes (rulings: `insight_actions` is append-only).
 */
export async function listInsightActions(ctx: TenantContext, insightId: string): Promise<InsightAction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("insight_actions")
    .select("*")
    .eq("institution_id", ctx.institution.id)
    .eq("insight_id", insightId)
    .order("decided_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const superseded = new Set(rows.map((r) => r.supersedes_id).filter((id): id is string => id !== null));
  return rows.filter((r) => !superseded.has(r.id)).map(toInsightAction);
}
