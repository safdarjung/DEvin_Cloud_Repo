import "server-only";
// AI roles P4 — exams.markOutliers. Thin wrapper over the `security
// invoker` SQL function `public.exam_mark_outliers` (0109): marks tables
// can run past PostgREST's `max_rows = 1000`, so the outlier scan itself
// runs in SQL (RLS on marks/exam_papers/results still scopes every row,
// same as every other read in this module). Only ids come back — no
// student/section/subject names (rule: never more than the caller's RLS
// already shows elsewhere).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export type MarkOutlierType = "above_max" | "percentage_drop" | "section_average";

export interface MarkOutlierRow {
  outlierType: MarkOutlierType;
  studentId: string | null;
  examPaperId: string;
  subjectId: string;
  classSectionId: string;
  details: Record<string, unknown>;
}

/** <=50 deterministic outliers for one exam (AI explains, never edits marks). */
export async function examMarkOutliers(ctx: TenantContext, examId: string): Promise<MarkOutlierRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_mark_outliers", {
    p_institution_id: ctx.institution.id,
    p_exam_id: examId,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    outlierType: row.outlier_type as MarkOutlierType,
    studentId: row.student_id as string | null,
    examPaperId: row.exam_paper_id as string,
    subjectId: row.subject_id as string,
    classSectionId: row.class_section_id as string,
    details: row.details as Record<string, unknown>,
  }));
}
