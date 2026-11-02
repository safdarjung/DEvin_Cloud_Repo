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
