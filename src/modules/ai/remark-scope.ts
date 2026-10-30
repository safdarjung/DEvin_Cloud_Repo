import "server-only";
// T-0NN — "may this member draft/save a remark for this result" check, the
// same shape as quiz-scope.ts's canGenerateQuizForUnit, but mirroring
// result_remarks' write RLS (0047) exactly: owner/principal/exam_controller
// (app.exam_write_roles(), admin excluded — lesson #1), or a teacher who
// teaches the result's student in ANY subject of their enrolled section
// (0025/0035's app.my_taught_student_ids() shape: class teacher of the
// section, or any subject_assignments row in it) — not paper/subject-scoped
// like marks entry, since one remark covers the whole result.
import type { TenantContext } from "@/lib/auth/types";
import type { createClient } from "@/lib/supabase/server";

type ExamsClient = Awaited<ReturnType<typeof createClient>>;

const EXAM_WRITE_ROLES = new Set(["owner", "principal", "exam_controller"]);

export async function canDraftRemarkForResult(
  supabase: ExamsClient,
  ctx: TenantContext,
  studentId: string,
): Promise<boolean> {
  if (EXAM_WRITE_ROLES.has(ctx.membership.role)) return true;

  const staffId = ctx.membership.staffId;
  if (!staffId) return false;

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active");
  if (enrolError) throw enrolError;

  const sectionIds = (enrolments ?? []).map((row) => row.class_section_id);
  if (sectionIds.length === 0) return false;

  const { data: classTeacherSection, error: classTeacherError } = await supabase
    .from("class_sections")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("class_teacher_id", staffId)
    .in("id", sectionIds)
    .limit(1)
    .maybeSingle();
  if (classTeacherError) throw classTeacherError;
  if (classTeacherSection) return true;

  const { data: assignment, error: assignmentError } = await supabase
    .from("subject_assignments")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("teacher_id", staffId)
    .in("class_section_id", sectionIds)
    .limit(1)
    .maybeSingle();
  if (assignmentError) throw assignmentError;

  return Boolean(assignment);
}
