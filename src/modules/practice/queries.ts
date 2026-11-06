import "server-only";
// Practice reads. Session client only: RLS (0103) lets the student, their
// guardians, the teachers of that student and leaders read attempts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { computeStreak, subjectAverages, type SubjectAverage } from "@/modules/practice/scoring";

const ATTEMPT_LIMIT = 100;
// Streaks are capped by this look-back window (days).
export const STREAK_WINDOW_DAYS = 90;

export interface PracticeAttemptSummary {
  id: string;
  curriculumUnitId: string;
  unitTitle: string | null;
  subjectId: string;
  subjectName: string | null;
  difficulty: string;
  score: number;
  maxScore: number;
  createdAt: string;
}

export interface PracticeProgress {
  totalAttempts: number;
  streak: number;
  subjects: (SubjectAverage & { subjectName: string | null })[];
}

export async function myPracticeAttempts(ctx: TenantContext, studentId: string): Promise<PracticeAttemptSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_attempts")
    .select("id, curriculum_unit_id, subject_id, difficulty, score, max_score, created_at, curriculum_units(title), subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(ATTEMPT_LIMIT);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    curriculumUnitId: r.curriculum_unit_id,
    unitTitle: (r.curriculum_units as { title: string } | null)?.title ?? null,
    subjectId: r.subject_id,
    subjectName: (r.subjects as { name: string } | null)?.name ?? null,
    difficulty: r.difficulty,
    score: r.score,
    maxScore: r.max_score,
    createdAt: r.created_at,
  }));
}

export async function practiceProgress(ctx: TenantContext, studentId: string): Promise<PracticeProgress> {
  const attempts = await myPracticeAttempts(ctx, studentId);

  const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 86_400_000).toISOString();
  const activity: string[] = attempts.filter((a) => a.createdAt >= since).map((a) => a.createdAt);

  // study_items are private to their owner (RLS user_id = caller), so they
  // only count toward the student's own streak, never a guardian's view.
  if (ctx.membership.studentId === studentId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_items")
      .select("created_at")
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .gte("created_at", since);
    if (error) throw error;
    activity.push(...(data ?? []).map((r) => r.created_at));
  }

  const names = new Map(attempts.map((a) => [a.subjectId, a.subjectName]));
  return {
    totalAttempts: attempts.length,
    streak: computeStreak(activity),
    subjects: subjectAverages(attempts).map((s) => ({ ...s, subjectName: names.get(s.subjectId) ?? null })),
  };
}
