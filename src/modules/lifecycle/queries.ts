import "server-only";
// M14-T8 — lifecycle.history: enrolment + lifecycle-event timeline for one
// student. RLS (0076 student_lifecycle_events_select, same shape as 0025
// students_select) is the only narrowing — the institution_id/student_id
// filters below are defense in depth, same shape as every other
// queries.ts in this codebase (mirrors src/modules/timetable/queries.ts).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface LifecycleEnrolment {
  id: string;
  academicYear: string;
  grade: string;
  section: string;
  rollNo: number | null;
  status: string;
  startedOn: string;
  endedOn: string | null;
}

export interface LifecycleEvent {
  id: string;
  kind: string;
  effectiveOn: string;
  reason: string | null;
  tcNo: string | null;
  tcSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

export interface LifecycleHistory {
  enrolments: LifecycleEnrolment[];
  events: LifecycleEvent[];
}

/** Every enrolment row (any status) + every lifecycle event for one student, oldest first. */
export async function lifecycleHistory(ctx: TenantContext, studentId: string): Promise<LifecycleHistory> {
  const supabase = await createClient();

  const [enrolmentsRes, eventsRes] = await Promise.all([
    supabase
      .from("enrolments")
      .select("id, roll_no, status, started_on, ended_on, academic_years(name), class_sections(name, grades(code))")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .order("started_on"),
    supabase
      .from("student_lifecycle_events")
      .select("id, kind, effective_on, reason, tc_no, tc_snapshot, created_at")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .order("created_at"),
  ]);
  if (enrolmentsRes.error) throw enrolmentsRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const enrolments = (enrolmentsRes.data ?? []).map((row) => {
    const year = row.academic_years as { name: string } | null;
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    return {
      id: row.id,
      academicYear: year?.name ?? "",
      grade: section?.grades?.code ?? "",
      section: section?.name ?? "",
      rollNo: row.roll_no,
      status: row.status,
      startedOn: row.started_on,
      endedOn: row.ended_on,
    };
  });

  const events = (eventsRes.data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    effectiveOn: row.effective_on,
    reason: row.reason,
    tcNo: row.tc_no,
    tcSnapshot: row.tc_snapshot as Record<string, unknown> | null,
    createdAt: row.created_at,
  }));

  return { enrolments, events };
}

export interface PromotionSection {
  id: string;
  label: string;
  name: string;
  gradeSortKey: number;
  /** Active enrolments (from-year only; 0 for to-year sections). */
  students: number;
}

export interface PromotionPlan {
  from: PromotionSection[];
  to: PromotionSection[];
}

/** Sections of both years with the from-year's active head-count: the preview the promote form shows before the confirm step. */
export async function promotionPlan(ctx: TenantContext, fromYearId: string, toYearId: string): Promise<PromotionPlan> {
  const supabase = await createClient();
  const load = async (yearId: string) => {
    const { data, error } = await supabase
      .from("class_sections")
      .select("id, name, grades(code, sort_key)")
      .eq("institution_id", ctx.institution.id)
      .eq("academic_year_id", yearId);
    if (error) throw error;
    return (data ?? []).map((r) => {
      const g = r.grades as { code: string; sort_key: number } | null;
      return { id: r.id, name: r.name, label: `${g?.code ?? "?"}-${r.name}`, gradeSortKey: g?.sort_key ?? 0 };
    });
  };
  const [from, to] = await Promise.all([load(fromYearId), load(toYearId)]);
  const counts = await Promise.all(
    from.map(async (s) => {
      const { count, error } = await supabase
        .from("enrolments")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", ctx.institution.id)
        .eq("class_section_id", s.id)
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    }),
  );
  const byOrder = (a: PromotionSection, b: PromotionSection) => a.gradeSortKey - b.gradeSortKey || a.name.localeCompare(b.name);
  return {
    from: from.map((s, i) => ({ ...s, students: counts[i] })).sort(byOrder),
    to: to.map((s) => ({ ...s, students: 0 })).sort(byOrder),
  };
}
