import "server-only";
// Behaviour reads. RLS (0113) narrows rows: staff M all, teacher taught students,
// guardian/student own non-voided. institution_id filters are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { IncidentListInput } from "./schemas";

export const BEHAVIOUR_PAGE_SIZE = 25;
const TOTALS_CAP = 2000;

export interface IncidentRow {
  id: string;
  studentId: string;
  studentName: string;
  category: string;
  severity: string;
  points: number;
  note: string | null;
  occurredOn: string;
  voidedAt: string | null;
  voidReason: string | null;
  reportedByMe: boolean;
}

export interface IncidentPage {
  rows: IncidentRow[];
  total: number;
  page: number;
  pageSize: number;
}

function fullName(s: { first_name: string; last_name: string | null } | null): string {
  return s ? [s.first_name, s.last_name].filter(Boolean).join(" ") : "Unknown";
}

async function studentIdsInSection(ctx: TenantContext, sectionId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrolments")
    .select("student_id")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", sectionId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((r) => r.student_id);
}

/** Filtered incident list (voided rows included for staff, flagged). Paged. */
export async function listIncidents(ctx: TenantContext, input: IncidentListInput = {}): Promise<IncidentPage> {
  const supabase = await createClient();
  const page = Math.max(1, input.page ?? 1);
  const from = (page - 1) * BEHAVIOUR_PAGE_SIZE;
  let q = supabase
    .from("behaviour_incidents")
    .select("id, student_id, category, severity, points, note, occurred_on, voided_at, void_reason, reported_by, students(first_name, last_name)", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + BEHAVIOUR_PAGE_SIZE - 1);
  if (input.category) q = q.eq("category", input.category);
  if (input.from) q = q.gte("occurred_on", input.from);
  if (input.to) q = q.lte("occurred_on", input.to);
  if (input.sectionId) {
    const ids = await studentIdsInSection(ctx, input.sectionId);
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize: BEHAVIOUR_PAGE_SIZE };
    q = q.in("student_id", ids);
  }
  const { data, error, count } = await q;
  // PGRST103: page past the last row -> empty page, not a 416 throw.
  if (error && error.code !== "PGRST103") throw error;
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: fullName(r.students as { first_name: string; last_name: string | null } | null),
    category: r.category,
    severity: r.severity,
    points: r.points,
    note: r.note,
    occurredOn: r.occurred_on,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    reportedByMe: r.reported_by === ctx.user.id,
  }));
  return { rows, total: count ?? 0, page, pageSize: BEHAVIOUR_PAGE_SIZE };
}

export interface StudentPointTotal {
  studentId: string;
  studentName: string;
  merit: number;
  demerit: number;
  total: number;
}

/** Per-student merit (+) / demerit (-) sums over non-voided incidents, same filters as the list. Lowest total first. Capped scan. */
export async function studentPointTotals(ctx: TenantContext, input: IncidentListInput = {}): Promise<StudentPointTotal[]> {
  const supabase = await createClient();
  let q = supabase
    .from("behaviour_incidents")
    .select("student_id, points, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .is("voided_at", null)
    .limit(TOTALS_CAP);
  if (input.category) q = q.eq("category", input.category);
  if (input.from) q = q.gte("occurred_on", input.from);
  if (input.to) q = q.lte("occurred_on", input.to);
  if (input.sectionId) {
    const ids = await studentIdsInSection(ctx, input.sectionId);
    if (ids.length === 0) return [];
    q = q.in("student_id", ids);
  }
  const { data, error } = await q;
  if (error) throw error;
  const byStudent = new Map<string, StudentPointTotal>();
  for (const r of data ?? []) {
    const t = byStudent.get(r.student_id) ?? {
      studentId: r.student_id,
      studentName: fullName(r.students as { first_name: string; last_name: string | null } | null),
      merit: 0,
      demerit: 0,
      total: 0,
    };
    if (r.points >= 0) t.merit += r.points;
    else t.demerit += r.points;
    t.total += r.points;
    byStudent.set(r.student_id, t);
  }
  return [...byStudent.values()].sort((a, b) => a.total - b.total);
}

export interface PortalIncident {
  id: string;
  category: string;
  severity: string;
  points: number;
  note: string | null;
  occurredOn: string;
}

/** Own child / self timeline: non-voided incidents + running total. Reporter is never exposed. */
export async function portalTimeline(ctx: TenantContext, studentId: string): Promise<{ incidents: PortalIncident[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("behaviour_incidents")
    .select("id, category, severity, points, note, occurred_on")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .is("voided_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const incidents = (data ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    points: r.points,
    note: r.note,
    occurredOn: r.occurred_on,
  }));
  return { incidents, total: incidents.reduce((s, i) => s + i.points, 0) };
}
