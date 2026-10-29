import "server-only";
// T-022 — shared "does this member teach this section/subject" logic, used
// by both assignments.actions.ts (assertTeacherScope) and
// assignments.queries.ts (listTeachableSections/listSectionSubjects). Single
// place to change if the scope rule ever changes.
import type { TenantContext } from "@/lib/auth/types";
import type { createClient } from "@/lib/supabase/server";

type AcademicsClient = Awaited<ReturnType<typeof createClient>>;

/**
 * True for owner/principal (full management, matches the
 * assignments_insert/_update RLS policies, 0005) or the section's own class
 * teacher (who may use any subject in their section, same as
 * app.teaches_section's own bypass, 0001). Admin is NOT included: admin has
 * no `assignment.manage` permission (07 §2.2), so defineAction's permission
 * gate already blocks it before any handler using this runs.
 */
export function managesWholeSection(ctx: TenantContext, classTeacherId: string | null): boolean {
  if (ctx.membership.role === "owner" || ctx.membership.role === "principal") return true;
  return Boolean(ctx.membership.staffId && classTeacherId === ctx.membership.staffId);
}

/** A `subject_assignments` row for exactly this (section, subject, teacher). */
export async function teachesSubjectInSection(
  supabase: AcademicsClient,
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  staffId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("class_section_id", classSectionId)
    .eq("subject_id", subjectId)
    .eq("teacher_id", staffId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Every class_section_id this staff member has ANY `subject_assignments` row for (any subject) — used to decide which sections to even list. */
export async function taughtSectionIds(
  supabase: AcademicsClient,
  institutionId: string,
  staffId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("class_section_id")
    .eq("institution_id", institutionId)
    .eq("teacher_id", staffId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.class_section_id));
}
