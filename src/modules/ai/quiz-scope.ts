import "server-only";
// T-036 — "may this member generate a quiz for a unit of this grade+subject"
// check. A curriculum unit belongs to a grade and subject, not a section
// (lead ruling T-036 §2), so this is deliberately not
// `teachesSubjectInSection` from `teacher-scope.ts` (section-scoped, owned
// by T-022/assignments — import only): it checks "taught in ANY section of
// the grade" instead of one specific section.
import { managesWholeSection } from "@/modules/academics/teacher-scope";
import type { TenantContext } from "@/lib/auth/types";
import type { createClient } from "@/lib/supabase/server";

type AcademicsClient = Awaited<ReturnType<typeof createClient>>;

/**
 * True for owner/principal (org-wide, 07 §2.2 — `managesWholeSection`'s
 * `null` class-teacher-id argument is deliberate: there is no single
 * section here, and owner/principal pass regardless of it). Every other
 * role (teacher, or admin should it ever gain `ai.generate` scope needs)
 * must have a `subject_assignments` row for this exact subject in at
 * least one section of this grade.
 */
export async function canGenerateQuizForUnit(
  supabase: AcademicsClient,
  ctx: TenantContext,
  gradeId: string,
  subjectId: string,
): Promise<boolean> {
  if (managesWholeSection(ctx, null)) return true;

  const staffId = ctx.membership.staffId;
  if (!staffId) return false;

  const { data: sections, error: sectionsError } = await supabase
    .from("class_sections")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", gradeId);
  if (sectionsError) throw sectionsError;

  const sectionIds = (sections ?? []).map((row) => row.id);
  if (sectionIds.length === 0) return false;

  const { data: assignment, error: assignmentError } = await supabase
    .from("subject_assignments")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("subject_id", subjectId)
    .eq("teacher_id", staffId)
    .in("class_section_id", sectionIds)
    .limit(1)
    .maybeSingle();
  if (assignmentError) throw assignmentError;

  return Boolean(assignment);
}
