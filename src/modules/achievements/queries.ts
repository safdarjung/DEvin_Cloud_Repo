import "server-only";
// Achievements reads. RLS (0128) narrows rows: M all, teacher taught students, guardian/student own
// non-voided. institution_id filters are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AppError } from "@/lib/actions/result";
import type { AchievementListInput } from "./schemas";

export const ACHIEVEMENTS_PAGE_SIZE = 25;
const PORTFOLIO_CAP = 200;
const SUMMARY_CAP = 5000;
const COLUMNS =
  "id, student_id, title, category, level, position, event_date, description, recorded_by, verified_at, voided_at, void_reason, students(first_name, last_name)";

export interface AchievementRow {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  category: string;
  level: string;
  position: string | null;
  eventDate: string;
  description: string | null;
  verified: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  recordedByMe: boolean;
}

export interface AchievementPage {
  rows: AchievementRow[];
  total: number;
  page: number;
  pageSize: number;
}

type StudentJoin = { first_name: string; last_name: string | null } | null;
type RawRow = {
  id: string;
  student_id: string;
  title: string;
  category: string;
  level: string;
  position: string | null;
  event_date: string;
  description: string | null;
  recorded_by: string;
  verified_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  students: unknown;
};

function fullName(s: StudentJoin): string {
  return s ? [s.first_name, s.last_name].filter(Boolean).join(" ") : "Unknown";
}

function toRow(r: RawRow, ctx: TenantContext): AchievementRow {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: fullName(r.students as StudentJoin),
    title: r.title,
    category: r.category,
    level: r.level,
    position: r.position,
    eventDate: r.event_date,
    description: r.description,
    verified: r.verified_at !== null,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    recordedByMe: r.recorded_by === ctx.user.id,
  };
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

/** Filtered list (voided rows included for staff, flagged). Paged, newest event first. */
export async function listAchievements(ctx: TenantContext, input: AchievementListInput = {}): Promise<AchievementPage> {
  const supabase = await createClient();
  const page = Math.max(1, input.page ?? 1);
  const from = (page - 1) * ACHIEVEMENTS_PAGE_SIZE;
  let q = supabase
    .from("achievements")
    .select(COLUMNS, { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + ACHIEVEMENTS_PAGE_SIZE - 1);
  if (input.category) q = q.eq("category", input.category);
  if (input.level) q = q.eq("level", input.level);
  if (input.verified === "yes") q = q.not("verified_at", "is", null);
  if (input.verified === "no") q = q.is("verified_at", null);
  if (input.sectionId) {
    const ids = await studentIdsInSection(ctx, input.sectionId);
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize: ACHIEVEMENTS_PAGE_SIZE };
    q = q.in("student_id", ids);
  }
  const { data, error, count } = await q;
  // PGRST103: page past the last row -> empty page, not a 416 throw.
  if (error && error.code !== "PGRST103") throw error;
  return { rows: (data ?? []).map((r) => toRow(r as RawRow, ctx)), total: count ?? 0, page, pageSize: ACHIEVEMENTS_PAGE_SIZE };
}

export interface Portfolio {
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  entries: AchievementRow[];
}

/** One student's non-voided entries, newest first. RLS decides whether the caller may see them (none -> empty). */
export async function studentPortfolio(ctx: TenantContext, studentId: string): Promise<Portfolio> {
  const supabase = await createClient();
  const [{ data: student, error: sError }, { data, error }] = await Promise.all([
    supabase.from("students").select("first_name, last_name, admission_no").eq("id", studentId).eq("institution_id", ctx.institution.id).maybeSingle(),
    supabase
      .from("achievements")
      .select(COLUMNS)
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .is("voided_at", null)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(PORTFOLIO_CAP),
  ]);
  if (sError) throw sError;
  if (error) throw error;
  if (!student) throw new AppError("not_found", "Student not found.");
  return {
    studentId,
    studentName: fullName(student),
    admissionNo: student.admission_no,
    entries: (data ?? []).map((r) => toRow(r as RawRow, ctx)),
  };
}

export interface AchievementSummary {
  byCategory: { category: string; count: number }[];
  byLevel: { level: string; count: number }[];
  total: number;
}

/** Name-free aggregate: non-voided counts by category and level. Capped scan. */
export async function achievementSummary(ctx: TenantContext): Promise<AchievementSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("achievements")
    .select("category, level")
    .eq("institution_id", ctx.institution.id)
    .is("voided_at", null)
    .limit(SUMMARY_CAP);
  if (error) throw error;
  const cat = new Map<string, number>();
  const lvl = new Map<string, number>();
  for (const r of data ?? []) {
    cat.set(r.category, (cat.get(r.category) ?? 0) + 1);
    lvl.set(r.level, (lvl.get(r.level) ?? 0) + 1);
  }
  return {
    byCategory: [...cat].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byLevel: [...lvl].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count),
    total: data?.length ?? 0,
  };
}
