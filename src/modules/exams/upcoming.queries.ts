import "server-only";
// Dashboard: papers scheduled from now onward. Signed-in user's RLS client only.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface UpcomingExamPaper {
  id: string;
  examId: string;
  examName: string;
  subjectName: string;
  section: string;
  scheduledAt: string;
}

/** Papers scheduled from `nowIso` onward, soonest first, with the true total. */
export async function upcomingExamPapers(ctx: TenantContext, nowIso: string, limit = 5): Promise<{ total: number; papers: UpcomingExamPaper[] }> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("exam_papers")
    .select("id, exam_id, scheduled_at, exams(name), subjects(name), class_sections(name, grades(code))", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return {
    total: count ?? 0,
    papers: (data ?? []).map((r) => {
      const section = r.class_sections as { name: string; grades: { code: string } | null } | null;
      return {
        id: r.id,
        examId: r.exam_id,
        examName: (r.exams as { name: string } | null)?.name ?? "",
        subjectName: (r.subjects as { name: string } | null)?.name ?? "",
        section: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
        scheduledAt: r.scheduled_at as string,
      };
    }),
  };
}
