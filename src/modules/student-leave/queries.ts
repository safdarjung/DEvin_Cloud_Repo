import "server-only";
// X01-T7 — studentLeave.list: the only read for student_leave_requests
// (owned by this module). RLS (0085 part 1) already narrows to the admin
// trio / the class teacher's own sections / the guardian's own children /
// the student itself (rulings) — RLS is the only row filter; the input
// filters below just narrow further within whatever RLS already allows,
// same shape as every other queries.ts (mirrors src/modules/people/
// hr.queries.ts's leaveRequests). Pending rows always sort first (ruling),
// which postgrest's .order() can't express on a non-enum column, so pending
// and the rest are fetched as two ordered, limited reads and concatenated.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { StudentLeaveListInput } from "@/modules/student-leave/schemas";

const DEFAULT_LIMIT = 50;

export interface StudentLeaveRow {
  id: string;
  studentId: string;
  studentName: string;
  classSection: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function toRow(row: {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  students: unknown;
  class_sections: unknown;
}): StudentLeaveRow {
  const student = row.students as { first_name: string; last_name: string | null } | null;
  const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
    classSection: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
    startDate: row.start_date,
    endDate: row.end_date,
    days: daysBetweenInclusive(row.start_date, row.end_date),
    reason: row.reason,
    status: row.status,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  };
}

/** institution-scoped select + the optional non-status filters, shared by both the pending and the non-pending read below. */
function filtered(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: TenantContext,
  input: StudentLeaveListInput,
) {
  let query = supabase
    .from("student_leave_requests")
    .select(
      "id, student_id, start_date, end_date, reason, status, decided_at, decision_note, created_at, students:student_id(first_name, last_name), class_sections:class_section_id(name, grades(code))",
    )
    .eq("institution_id", ctx.institution.id);
  if (input.studentId) query = query.eq("student_id", input.studentId);
  if (input.classSectionId) query = query.eq("class_section_id", input.classSectionId);
  if (input.from) query = query.gte("end_date", input.from);
  if (input.to) query = query.lte("start_date", input.to);
  return query;
}

/** Pending first, then start_date descending; default limit 50 (rulings). RLS is the only row filter. */
export async function studentLeaveRequests(ctx: TenantContext, input: StudentLeaveListInput): Promise<StudentLeaveRow[]> {
  const supabase = await createClient();
  const limit = input.limit ?? DEFAULT_LIMIT;

  if (input.status) {
    const { data, error } = await filtered(supabase, ctx, input)
      .eq("status", input.status)
      .order("start_date", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(toRow);
  }

  const { data: pendingRows, error: pendingError } = await filtered(supabase, ctx, input)
    .eq("status", "pending")
    .order("start_date", { ascending: false })
    .limit(limit);
  if (pendingError) throw pendingError;

  const rows = pendingRows ?? [];
  const remaining = limit - rows.length;
  let otherRows: typeof rows = [];
  if (remaining > 0) {
    const { data, error } = await filtered(supabase, ctx, input)
      .neq("status", "pending")
      .order("start_date", { ascending: false })
      .limit(remaining);
    if (error) throw error;
    otherRows = data ?? [];
  }

  return [...rows, ...otherRows].map(toRow);
}
