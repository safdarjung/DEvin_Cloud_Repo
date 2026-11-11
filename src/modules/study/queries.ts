import "server-only";
// Study studio reads. Session client only: RLS (0138) decides what each role
// sees — a student their own material plus material shared with their
// section, a guardian their child's plans and progress, a teacher their own
// shared material and its engagement, leaders teacher material school-wide.
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { createClient } from "@/lib/supabase/server";
import { masteryGapsForStudent } from "@/modules/mastery/queries";
import { myPracticeAttempts } from "@/modules/practice/queries";
import { computeStreak, istDay } from "@/modules/practice/scoring";
import { accuracyBy, cardLapses, minutesByDay, questionAccuracy, weakTopics, weeklyAccuracy, type ScoredRow } from "@/modules/study/analytics";
import type { QuizQuestion, StudyFormat } from "@/modules/study/formats";
import type { QuizAnswer } from "@/modules/study/quiz";
import type { PlanItem } from "@/modules/study/planner";
import { DeckStateSchema, drillQueue, dueCardIds, type CardState } from "@/modules/study/srs";

const LIBRARY_LIMIT = 200;
const PROGRESS_DAYS = 90;

export interface StudyMaterialRow {
  id: string;
  format: StudyFormat;
  title: string;
  isMine: boolean;
  fromTeacher: boolean;
  subjectId: string | null;
  subjectName: string | null;
  unitId: string | null;
  createdAt: string;
}

const subjectName = (r: { subjects: unknown }): string | null => (r.subjects as { name: string } | null)?.name ?? null;

/** Own material plus material a teacher shared with the caller's section, newest first. */
export async function studyLibrary(ctx: TenantContext): Promise<StudyMaterialRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_materials")
    .select("id, user_id, owner_role, format, title, subject_id, curriculum_unit_id, created_at, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(LIBRARY_LIMIT);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    format: r.format as StudyFormat,
    title: r.title,
    isMine: r.user_id === ctx.user.id,
    fromTeacher: r.owner_role === "teacher",
    subjectId: r.subject_id,
    subjectName: subjectName(r),
    unitId: r.curriculum_unit_id,
    createdAt: r.created_at,
  }));
}

export interface StudyMaterial extends StudyMaterialRow {
  content: unknown;
}

export async function getStudyMaterial(ctx: TenantContext, id: string): Promise<StudyMaterial | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_materials")
    .select("id, user_id, owner_role, format, title, subject_id, curriculum_unit_id, created_at, content, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    format: data.format as StudyFormat,
    title: data.title,
    isMine: data.user_id === ctx.user.id,
    fromTeacher: data.owner_role === "teacher",
    subjectId: data.subject_id,
    subjectName: subjectName(data),
    unitId: data.curriculum_unit_id,
    createdAt: data.created_at,
    content: data.content,
  };
}

export interface DeckSummary {
  id: string;
  title: string;
  fromTeacher: boolean;
  subjectName: string | null;
  cards: number;
  due: number;
  fresh: number;
}

export interface DeckForDrill {
  id: string;
  title: string;
  fromTeacher: boolean;
  subjectId: string | null;
  cards: { id: string; front: string; back: string }[];
  queue: string[];
}

async function decksWithState(ctx: TenantContext, studentId: string, deckId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("study_materials")
    .select("id, owner_role, title, subject_id, content, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("format", "flashcards")
    .order("created_at", { ascending: false })
    .limit(LIBRARY_LIMIT);
  if (deckId) query = query.eq("id", deckId);
  const [{ data: decks, error }, { data: progress, error: pError }] = await Promise.all([
    query,
    supabase.from("study_deck_progress").select("material_id, state").eq("institution_id", ctx.institution.id).eq("student_id", studentId),
  ]);
  if (error || pError) throw error ?? pError;
  const states = new Map<string, Record<string, CardState>>();
  for (const p of progress ?? []) {
    const parsed = DeckStateSchema.safeParse(p.state);
    if (parsed.success) states.set(p.material_id, parsed.data);
  }
  return (decks ?? []).map((d) => ({
    deck: d,
    cards: ((d.content as { cards?: { id: string; front: string; back: string }[] } | null)?.cards ?? []),
    state: states.get(d.id) ?? {},
  }));
}

export async function deckSummaries(ctx: TenantContext, studentId: string): Promise<DeckSummary[]> {
  const today = istDay(new Date());
  return (await decksWithState(ctx, studentId)).map(({ deck, cards, state }) => ({
    id: deck.id,
    title: deck.title,
    fromTeacher: deck.owner_role === "teacher",
    subjectName: subjectName(deck),
    cards: cards.length,
    due: dueCardIds(cards, state, today).length,
    fresh: cards.filter((c) => !state[c.id]).length,
  }));
}

export async function deckForDrill(ctx: TenantContext, studentId: string, deckId: string): Promise<DeckForDrill | null> {
  const [found] = await decksWithState(ctx, studentId, deckId);
  if (!found) return null;
  return {
    id: found.deck.id,
    title: found.deck.title,
    fromTeacher: found.deck.owner_role === "teacher",
    subjectId: found.deck.subject_id,
    cards: found.cards,
    queue: drillQueue(found.cards, found.state, istDay(new Date())),
  };
}

export interface ActivePlan {
  id: string;
  title: string;
  examLabel: string | null;
  startDate: string;
  targetDate: string;
  minutesPerDay: number;
  items: PlanItem[];
}

export async function activeStudyPlan(ctx: TenantContext, studentId: string): Promise<ActivePlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_plans")
    .select("id, title, exam_label, start_date, target_date, minutes_per_day, items")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    examLabel: data.exam_label,
    startDate: data.start_date,
    targetDate: data.target_date,
    minutesPerDay: data.minutes_per_day,
    items: data.items as unknown as PlanItem[],
  };
}

export interface StudioAttempt {
  id: string;
  title: string;
  materialId: string | null;
  subjectName: string | null;
  score: number;
  max: number;
  aiPoints: number;
  aiMax: number;
  createdAt: string;
}

export interface StudyProgress {
  streak: number;
  minutesThisWeek: number;
  days: { day: string; minutes: number }[];
  weekly: { weekStart: string; percent: number | null; total: number }[];
  subjects: ReturnType<typeof accuracyBy>;
  weak: ReturnType<typeof weakTopics>;
  attempts: StudioAttempt[];
  questionsAnswered: number;
}

/** Progress for the student (or a linked guardian): practice + studio quizzes, study time, mastery gaps. */
export async function studyProgress(ctx: TenantContext, studentId: string): Promise<StudyProgress> {
  const supabase = await createClient();
  const since = new Date(Date.now() - PROGRESS_DAYS * 86_400_000).toISOString();
  const wantsMastery = isModuleEnabled(ctx, "mastery") && hasPermission(ctx, "mastery.read");
  const [practice, studio, sessions, gaps] = await Promise.all([
    isModuleEnabled(ctx, "practice") ? myPracticeAttempts(ctx, studentId) : Promise.resolve([]),
    supabase
      .from("study_quiz_attempts")
      .select("id, title, material_id, subject_id, curriculum_unit_id, auto_score, auto_max, ai_points, ai_max, created_at, subjects(name), curriculum_units(title)")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(LIBRARY_LIMIT),
    supabase.from("study_sessions").select("minutes, started_at").eq("institution_id", ctx.institution.id).eq("student_id", studentId).gte("started_at", since),
    wantsMastery ? masteryGapsForStudent(ctx, studentId).catch(() => []) : Promise.resolve([]),
  ]);
  if (studio.error || sessions.error) throw studio.error ?? sessions.error;

  const rows: ScoredRow[] = [
    ...practice.map((p) => ({ at: p.createdAt, subjectId: p.subjectId, subjectName: p.subjectName, unitId: p.curriculumUnitId, unitTitle: p.unitTitle, correct: p.score, total: p.maxScore })),
    ...(studio.data ?? []).map((a) => ({
      at: a.created_at,
      subjectId: a.subject_id,
      subjectName: subjectName(a),
      unitId: a.curriculum_unit_id,
      unitTitle: (a.curriculum_units as { title: string } | null)?.title ?? null,
      // AI-checked short answers count as practice evidence at half a question per point.
      correct: a.auto_score + a.ai_points / 2,
      total: a.auto_max + a.ai_max / 2,
    })),
  ];
  const sessionRows = (sessions.data ?? []).map((s) => ({ startedAt: s.started_at, minutes: s.minutes }));
  const days = minutesByDay(sessionRows, 7);
  return {
    streak: computeStreak([...rows.map((r) => r.at), ...sessionRows.map((s) => s.startedAt)]),
    minutesThisWeek: days.reduce((n, d) => n + d.minutes, 0),
    days,
    weekly: weeklyAccuracy(rows, 8),
    subjects: accuracyBy(rows, "subject"),
    weak: weakTopics(accuracyBy(rows, "unit"), gaps),
    attempts: (studio.data ?? []).slice(0, 10).map((a) => ({
      id: a.id,
      title: a.title,
      materialId: a.material_id,
      subjectName: subjectName(a),
      score: a.auto_score,
      max: a.auto_max,
      aiPoints: a.ai_points,
      aiMax: a.ai_max,
      createdAt: a.created_at,
    })),
    questionsAnswered: rows.reduce((n, r) => n + r.total, 0),
  };
}

// ---------------------------------------------------------------------------
// Teacher / leaders: shared material and engagement (counts and percentages only)
// ---------------------------------------------------------------------------

export interface SectionEngagement {
  sectionId: string;
  sectionLabel: string;
  enrolled: number;
  engaged: number;
  attempts: number;
  avgPercent: number | null;
}

export interface SharedMaterialEngagement {
  id: string;
  format: StudyFormat;
  title: string;
  createdAt: string;
  subjectName: string | null;
  sections: SectionEngagement[];
  /** Weakest questions (quiz) or most-missed cards (deck): label + % correct or students who missed it. */
  weakSpots: { label: string; detail: string }[];
}

/** Teacher material with per-section engagement. Teachers get their own; leaders every teacher's (RLS). */
export async function sharedMaterialEngagement(ctx: TenantContext, onlyMine: boolean): Promise<SharedMaterialEngagement[]> {
  const supabase = await createClient();
  let query = supabase
    .from("study_materials")
    .select("id, format, title, content, created_at, subjects(name), study_material_sections(class_section_id, class_sections(name, grades(code)))")
    .eq("institution_id", ctx.institution.id)
    .eq("owner_role", "teacher")
    .order("created_at", { ascending: false })
    .limit(50);
  if (onlyMine) query = query.eq("user_id", ctx.user.id);
  const { data: materials, error } = await query;
  if (error) throw error;
  const list = materials ?? [];
  if (list.length === 0) return [];

  const ids = list.map((m) => m.id);
  const sectionIds = [...new Set(list.flatMap((m) => (m.study_material_sections ?? []).map((s) => s.class_section_id)))];
  const [enrolments, attempts, progress] = await Promise.all([
    sectionIds.length
      ? supabase.from("enrolments").select("student_id, class_section_id").eq("institution_id", ctx.institution.id).eq("status", "active").in("class_section_id", sectionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("study_quiz_attempts").select("student_id, material_id, questions, answers, ai_checks, auto_score, auto_max, ai_points, ai_max").in("material_id", ids),
    supabase.from("study_deck_progress").select("student_id, material_id, state").in("material_id", ids),
  ]);
  if (enrolments.error || attempts.error || progress.error) throw enrolments.error ?? attempts.error ?? progress.error;

  const sectionOf = new Map((enrolments.data ?? []).map((e) => [e.student_id, e.class_section_id]));
  const enrolledIn = (sectionId: string) => (enrolments.data ?? []).filter((e) => e.class_section_id === sectionId).length;

  return list.map((m) => {
    const mAttempts = (attempts.data ?? []).filter((a) => a.material_id === m.id);
    const mProgress = (progress.data ?? []).filter((p) => p.material_id === m.id);
    const sections = (m.study_material_sections ?? []).map((s) => {
      const cs = s.class_sections as { name: string; grades: { code: string } | null } | null;
      const inSection = (studentId: string) => sectionOf.get(studentId) === s.class_section_id;
      const sAttempts = mAttempts.filter((a) => inSection(a.student_id));
      const engaged = new Set([...sAttempts.map((a) => a.student_id), ...mProgress.filter((p) => inSection(p.student_id)).map((p) => p.student_id)]);
      const pcts = sAttempts.map((a) => ((a.auto_score + a.ai_points / 2) / Math.max(1, a.auto_max + a.ai_max / 2)) * 100);
      return {
        sectionId: s.class_section_id,
        sectionLabel: `${cs?.grades?.code ?? "?"}-${cs?.name ?? "?"}`,
        enrolled: enrolledIn(s.class_section_id),
        engaged: engaged.size,
        attempts: sAttempts.length,
        avgPercent: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null,
      };
    });
    const weakSpots =
      m.format === "quiz"
        ? questionAccuracy(
            mAttempts.map((a) => ({
              questions: a.questions as unknown as QuizQuestion[],
              answers: a.answers as unknown as QuizAnswer[],
              aiChecks: a.ai_checks as unknown as { score: number }[],
            })),
          )
            .slice(0, 3)
            .map((q) => ({ label: q.stem, detail: `${q.percent}% right (${q.answered} answers)` }))
        : m.format === "flashcards"
          ? cardLapses(
              ((m.content as { cards?: { id: string; front: string }[] } | null)?.cards ?? []),
              mProgress.map((p) => (DeckStateSchema.safeParse(p.state).data ?? {}) as Record<string, CardState>),
            )
              .slice(0, 3)
              .map((c) => ({ label: c.front, detail: `missed by ${c.students} ${c.students === 1 ? "student" : "students"}` }))
          : [];
    return {
      id: m.id,
      format: m.format as StudyFormat,
      title: m.title,
      createdAt: m.created_at,
      subjectName: subjectName(m),
      sections,
      weakSpots,
    };
  });
}

/** The teacher's readable lesson plans (RLS: their sections and subjects), newest first, for the source picker. */
export async function lessonPlanOptions(ctx: TenantContext): Promise<{ id: string; title: string; plannedOn: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lesson_plans")
    .select("id, title, planned_on")
    .eq("institution_id", ctx.institution.id)
    .order("planned_on", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []).map((l) => ({ id: l.id, title: l.title, plannedOn: l.planned_on }));
}
