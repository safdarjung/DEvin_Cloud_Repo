import "server-only";
// Study with AI on a chosen scope (0140 item 8): what a student may pick
// (their own grade's subjects -> the school's textbooks for them -> chapters
// -> units, plus files they may read), their per-unit progress, and the
// server-built context for a saved scope. Caller's RLS client throughout;
// textbook tables are read directly here (the textbooks module belongs to
// another packet). A school-copy PDF (0142 documents 'subject_textbook') is
// offered when present; its absence is tolerated.
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { FILE_READ_MAX_BYTES } from "@/lib/ai/file-input";
import { createClient } from "@/lib/supabase/server";
import { studentEvidence, studentUnits } from "@/modules/study/help-sources";
import { studyFileOptions } from "@/modules/study/help.queries";
import { StudyScopeSchema, buildScopeContext, type ScopeAllowed, type ScopeContext, type StudyScope, type UnitProgress } from "@/modules/study/scope";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface ScopeFile {
  id: string;
  title: string;
  subjectId: string | null;
  readable: boolean;
  /** curriculum_materials row, or the school's copy of a textbook (subject_textbooks id). */
  kind: "material" | "textbook";
}

export interface ScopeOptions {
  allowed: ScopeAllowed;
  files: ScopeFile[];
  progress: Record<string, UnitProgress>;
}

async function textbooks(supabase: Client, ctx: TenantContext, gradeId: string, subjectIds: readonly string[]): Promise<ScopeAllowed["books"]> {
  if (subjectIds.length === 0) return [];
  const { data, error } = await supabase
    .from("subject_textbooks")
    .select("id, subject_id, custom_title, custom_chapters, chapter_titles, position, ncert_textbooks(title, chapters_count, class_level)")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", gradeId)
    .in("subject_id", [...subjectIds])
    .order("position");
  if (error) throw error;
  return (data ?? []).map((b) => {
    const ncert = b.ncert_textbooks as { title: string; chapters_count: number; class_level: number | null } | null;
    return {
      id: b.id,
      subjectId: b.subject_id,
      title: ncert ? `${ncert.title}${ncert.class_level ? ` (Class ${ncert.class_level})` : ""}` : (b.custom_title ?? "Textbook"),
      ncert: Boolean(ncert),
      chapterCount: ncert?.chapters_count ?? b.custom_chapters ?? 0,
      chapterTitles: (b.chapter_titles ?? {}) as Record<string, string>,
    };
  });
}

/** Everything the scope picker offers the student, plus their per-unit progress. */
export async function scopeOptions(ctx: TenantContext): Promise<ScopeOptions> {
  const studentId = ctx.membership.studentId;
  if (!studentId) throw new AppError("forbidden", "Study with AI is for students.");
  const supabase = await createClient();
  const { units, gradeId } = await studentUnits(supabase, ctx);
  const subjectIds = [...new Set(units.map((u) => u.subjectId))];
  const { data: subjectRows, error: sError } = await supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).in("id", subjectIds.length ? subjectIds : ["00000000-0000-0000-0000-000000000000"]);
  if (sError) throw sError;
  const [books, chapterRows, materialFiles] = await Promise.all([
    textbooks(supabase, ctx, gradeId, subjectIds),
    units.length
      ? supabase.from("curriculum_unit_chapters").select("curriculum_unit_id, subject_textbook_id, chapter_no").eq("institution_id", ctx.institution.id).in("curriculum_unit_id", units.map((u) => u.id))
      : Promise.resolve({ data: [], error: null }),
    studyFileOptions(ctx),
  ]);
  if (chapterRows.error) throw chapterRows.error;
  const chapterOf = new Map((chapterRows.data ?? []).map((c) => [c.curriculum_unit_id, { textbookId: c.subject_textbook_id, no: c.chapter_no }]));

  // The school's own copy of a book (0142), when uploaded and small enough to read.
  const { data: copies } = books.length
    ? await supabase.from("documents").select("entity_id, size_bytes").eq("institution_id", ctx.institution.id).eq("entity_type", "subject_textbook").eq("status", "active").in("entity_id", books.map((b) => b.id))
    : { data: [] as { entity_id: string; size_bytes: number }[] };
  const files: ScopeFile[] = [
    ...materialFiles.filter((f) => f.subjectId === null || subjectIds.includes(f.subjectId)).map((f) => ({ id: f.id, title: f.title, subjectId: f.subjectId, readable: !f.tooBig, kind: "material" as const })),
    ...(copies ?? []).map((c) => {
      const book = books.find((b) => b.id === c.entity_id)!;
      return { id: c.entity_id, title: `School copy: ${book.title}`, subjectId: book.subjectId, readable: c.size_bytes <= FILE_READ_MAX_BYTES, kind: "textbook" as const };
    }),
  ];

  const progress = await unitProgress(supabase, ctx, studentId, units.map((u) => u.id));
  return {
    allowed: {
      subjects: (subjectRows ?? []).map((s) => ({ id: s.id, name: s.name })),
      books,
      units: units.map((u) => ({ id: u.id, subjectId: u.subjectId, title: u.title, description: u.description, chapter: chapterOf.get(u.id) ?? null })),
      files: files.map((f) => ({ id: f.id, title: f.title, subjectId: f.subjectId, readable: f.readable })),
    },
    files,
    progress,
  };
}

/** Per unit: recency-free accuracy from practice + studio quizzes, minutes and last study time. */
async function unitProgress(supabase: Client, ctx: TenantContext, studentId: string, unitIds: readonly string[]): Promise<Record<string, UnitProgress>> {
  if (unitIds.length === 0) return {};
  const [{ evidence }, sessions] = await Promise.all([
    studentEvidence(supabase, ctx, studentId),
    supabase.from("study_sessions").select("curriculum_unit_id, minutes, started_at").eq("institution_id", ctx.institution.id).eq("student_id", studentId).in("curriculum_unit_id", [...unitIds]).limit(1000),
  ]);
  if (sessions.error) throw sessions.error;
  const out: Record<string, UnitProgress & { c: number; t: number }> = {};
  const slot = (id: string) => (out[id] ??= { accuracy: null, minutes: 0, lastStudied: null, c: 0, t: 0 });
  for (const e of evidence) {
    if (!unitIds.includes(e.unitId)) continue;
    const s = slot(e.unitId);
    s.c += e.correct;
    s.t += e.total;
    if (!s.lastStudied || e.at > s.lastStudied) s.lastStudied = e.at;
  }
  for (const r of sessions.data ?? []) {
    const s = slot(r.curriculum_unit_id!);
    s.minutes += r.minutes;
    if (!s.lastStudied || r.started_at > s.lastStudied) s.lastStudied = r.started_at;
  }
  return Object.fromEntries(Object.entries(out).map(([id, s]) => [id, { accuracy: s.t > 0 ? Math.round((s.c / s.t) * 100) : null, minutes: s.minutes, lastStudied: s.lastStudied }]));
}

async function teacherMaterialTitles(supabase: Client, ctx: TenantContext, unitIds: readonly string[]): Promise<{ unitId: string; title: string }[]> {
  if (unitIds.length === 0) return [];
  // RLS: only material shared with the student's own section is visible.
  const { data, error } = await supabase
    .from("study_materials")
    .select("curriculum_unit_id, title")
    .eq("institution_id", ctx.institution.id)
    .eq("owner_role", "teacher")
    .in("curriculum_unit_id", [...unitIds])
    .limit(30);
  if (error) throw error;
  return (data ?? []).map((m) => ({ unitId: m.curriculum_unit_id!, title: m.title }));
}

/** The server-built context for a scope (ids re-checked against what the student may read now). */
export async function resolveScope(ctx: TenantContext, scope: StudyScope): Promise<{ context: ScopeContext; files: ScopeFile[] }> {
  const options = await scopeOptions(ctx);
  const supabase = await createClient();
  const built = buildScopeContext({ scope, allowed: options.allowed, progress: options.progress, teacherMaterials: await teacherMaterialTitles(supabase, ctx, options.allowed.units.map((u) => u.id)) });
  if (!built.ok) throw new AppError("validation_failed", built.reason);
  return { context: built.context, files: options.files.filter((f) => built.context.fileIds.includes(f.id)) };
}

export interface ScopeSession {
  id: string;
  title: string;
  scope: StudyScope;
  messages: unknown[];
  updatedAt: string;
}

/** The student's own scoped study chats (study_items RLS: own rows only). */
export async function scopeSessions(ctx: TenantContext): Promise<{ id: string; title: string; updatedAt: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_items")
    .select("id, title, updated_at")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .eq("kind", "chat")
    .not("scope", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function getScopeSession(ctx: TenantContext, itemId: string): Promise<ScopeSession | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_items")
    .select("id, title, scope, content, updated_at")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .eq("kind", "chat")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  const scope = StudyScopeSchema.safeParse(data?.scope);
  if (!data || !scope.success) return null;
  const messages = (data.content as { messages?: unknown[] } | null)?.messages ?? [];
  return { id: data.id, title: data.title, scope: scope.data, messages: Array.isArray(messages) ? messages : [], updatedAt: data.updated_at };
}
