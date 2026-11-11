import "server-only";
// 0141 — timetable control reads: the change log ("Why?" + Changes panel),
// versions and Compare, snapshots, and the dynamic day view. RLS (0141)
// narrows timetable_changes to managers (all) and, for everyone else, rows
// of the published version that explain their own timetable; the
// institution_id filters below are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission } from "@/lib/auth/require";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { calendarForRole } from "@/modules/calendar/queries";
import type { TimetablePeriod } from "@/components/widgets/timetable-widget";
import { activeSectionIdForStudent, defaultPublishedVersionId, fetchSlots, timetableTodayFor, toHHMM } from "./queries";
import { diffSlots, type CellContent, type CellSlot, type DiffRow } from "./checks";
import { loadAllSlots, loadSections, loadVersion } from "./suggest.queries";
import type { ChangesQueryInput, DayViewInput } from "./schemas";

/** What a logged cell held (names frozen at the time of the change). */
export interface LoggedCell {
  subjectId?: string | null;
  subject?: string | null;
  teacherId?: string | null;
  teacher?: string | null;
  roomId?: string | null;
  room?: string | null;
  versionId?: string;
  name?: string;
}

export interface ChangeRow {
  id: string;
  versionId: string | null;
  kind: string;
  action: string;
  classSectionId: string | null;
  weekday: number | null;
  periodId: string | null;
  onDate: string | null;
  substitutionId: string | null;
  label: string | null;
  before: LoggedCell | null;
  after: LoggedCell | null;
  reason: string;
  rules: string[];
  revertsChangeId: string | null;
  actorName: string;
  createdAt: string;
}

const CHANGE_COLUMNS =
  "id, version_id, kind, action, class_section_id, weekday, period_id, on_date, substitution_id, label, before, after, reason, rule_codes, reverts_change_id, actor_name, created_at";

type ChangeDbRow = {
  id: string;
  version_id: string | null;
  kind: string;
  action: string;
  class_section_id: string | null;
  weekday: number | null;
  period_id: string | null;
  on_date: string | null;
  substitution_id: string | null;
  label: string | null;
  before: unknown;
  after: unknown;
  reason: string;
  rule_codes: string[];
  reverts_change_id: string | null;
  actor_name: string | null;
  created_at: string;
};

function toChange(r: ChangeDbRow): ChangeRow {
  return {
    id: r.id,
    versionId: r.version_id,
    kind: r.kind,
    action: r.action,
    classSectionId: r.class_section_id,
    weekday: r.weekday,
    periodId: r.period_id,
    onDate: r.on_date,
    substitutionId: r.substitution_id,
    label: r.label,
    before: (r.before as LoggedCell | null) ?? null,
    after: (r.after as LoggedCell | null) ?? null,
    reason: r.reason,
    rules: r.rule_codes ?? [],
    revertsChangeId: r.reverts_change_id,
    actorName: r.actor_name ?? "School office",
    createdAt: r.created_at,
  };
}

/** The change log, newest first, filtered (section, teacher, date range, kind, version). */
export async function timetableChanges(ctx: TenantContext, input: ChangesQueryInput): Promise<ChangeRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("timetable_changes")
    .select(CHANGE_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit);
  if (input.versionId) query = query.eq("version_id", input.versionId);
  if (input.classSectionId) query = query.eq("class_section_id", input.classSectionId);
  if (input.teacherId) query = query.or(`teacher_id.eq.${input.teacherId},prev_teacher_id.eq.${input.teacherId}`);
  if (input.kind) query = query.eq("kind", input.kind);
  // shortcut: IST day bounds (every school so far is in India); use the institution timezone if that changes.
  if (input.from) query = query.gte("created_at", `${input.from}T00:00:00+05:30`);
  if (input.to) query = query.lt("created_at", `${input.to}T23:59:59.999+05:30`);
  const { data, error } = await query;
  if (error) throw error;
  return (data as ChangeDbRow[]).map(toChange);
}

/** Ids of changes that have been undone (some later row reverts them). */
export async function undoneChangeIds(ctx: TenantContext, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_changes")
    .select("reverts_change_id")
    .eq("institution_id", ctx.institution.id)
    .in("reverts_change_id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.reverts_change_id as string));
}

const cellKey = (sectionId: string, weekday: number, periodId: string) => `${sectionId}|${weekday}|${periodId}`;

/** Latest cell change (not a substitution) per cell of one section in one version — the "Why?" on each period. */
export async function latestCellChanges(ctx: TenantContext, versionId: string, classSectionId: string): Promise<Map<string, ChangeRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_changes")
    .select(CHANGE_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId)
    .eq("class_section_id", classSectionId)
    .is("substitution_id", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const out = new Map<string, ChangeRow>();
  for (const row of (data as ChangeDbRow[]).map(toChange)) {
    const key = cellKey(row.classSectionId!, row.weekday!, row.periodId!);
    if (!out.has(key)) out.set(key, row);
  }
  return out;
}

export interface VersionRow {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  academicYearId: string;
  publishedAt: string | null;
  createdAt: string;
}

/** Every version the caller can see (managers: all), newest first. */
export async function timetableVersions(ctx: TenantContext): Promise<VersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("id, name, status, academic_year_id, published_at, created_at")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    status: v.status as VersionRow["status"],
    academicYearId: v.academic_year_id,
    publishedAt: v.published_at,
    createdAt: v.created_at,
  }));
}

export interface CompareRow extends DiffRow {
  label: string;
  beforeText: string | null;
  afterText: string | null;
}

/** Slot-level differences going from one version to another, with readable cells. Requires timetable.manage. */
export async function timetableCompare(ctx: TenantContext, fromVersionId: string, toVersionId: string): Promise<CompareRow[]> {
  const supabase = await createClient();
  const institutionId = ctx.institution.id;
  const from = await loadVersion(supabase, fromVersionId, institutionId);
  await loadVersion(supabase, toVersionId, institutionId);
  const [a, b, sections, periods] = await Promise.all([
    loadAllSlots(supabase, institutionId, fromVersionId),
    loadAllSlots(supabase, institutionId, toVersionId),
    loadSections(supabase, institutionId, from.academicYearId, undefined),
    supabase.from("periods").select("id, name").eq("institution_id", institutionId),
  ]);
  if (periods.error) throw periods.error;
  const rows = diffSlots(a, b);
  const names = await cellNames(rows.flatMap((r) => [r.before, r.after]).filter((c): c is CellContent => c !== null), institutionId);
  const sectionLabel = new Map(sections.map((s) => [s.id, s.label]));
  const periodName = new Map((periods.data ?? []).map((p) => [p.id, p.name]));
  const text = (c: CellContent | null) =>
    c ? [names.subject.get(c.subjectId) ?? "?", names.teacher.get(c.teacherId) ?? "?", c.roomId ? names.room.get(c.roomId) : null].filter(Boolean).join(" · ") : null;
  return rows.map((r) => ({
    ...r,
    label: `${sectionLabel.get(r.classSectionId) ?? "?"} · ${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][r.weekday]} · ${periodName.get(r.periodId) ?? "?"}`,
    beforeText: text(r.before),
    afterText: text(r.after),
  }));
}

async function cellNames(cells: CellContent[], institutionId: string) {
  const supabase = await createClient();
  const ids = (pick: (c: CellContent) => string | null) => [...new Set(cells.map(pick).filter((x): x is string => !!x))];
  const [subjects, staff, rooms] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("institution_id", institutionId).in("id", ids((c) => c.subjectId)),
    supabase.from("staff").select("id, full_name").eq("institution_id", institutionId).in("id", ids((c) => c.teacherId)),
    supabase.from("rooms").select("id, name").eq("institution_id", institutionId).in("id", ids((c) => c.roomId)),
  ]);
  for (const r of [subjects, staff, rooms]) if (r.error) throw r.error;
  return {
    subject: new Map((subjects.data ?? []).map((r) => [r.id, r.name])),
    teacher: new Map((staff.data ?? []).map((r) => [r.id, r.full_name])),
    room: new Map((rooms.data ?? []).map((r) => [r.id, r.name])),
  };
}

export interface SnapshotRow {
  id: string;
  versionId: string;
  name: string;
  slotCount: number;
  createdAt: string;
}

/** Named snapshots of a version, newest first (slot counts only; restore reads the slots). Requires timetable.manage. */
export async function timetableSnapshots(ctx: TenantContext, versionId: string): Promise<SnapshotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_snapshots")
    .select("id, version_id, name, slots, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    versionId: s.version_id,
    name: s.name,
    slotCount: Array.isArray(s.slots) ? s.slots.length : 0,
    createdAt: s.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Dynamic day view
// ---------------------------------------------------------------------------

export interface DayOverlay {
  kind: "substitution" | "holiday" | "exam" | "event" | "changed";
  text: string;
  reason: string;
  who?: string;
  when?: string;
  changeId?: string;
  /** What "Undo" calls, when the viewer may undo it. */
  undo?: "substitution" | "cell";
}

export interface DayPeriod {
  seq: number;
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  regular: { subject: string | null; teacher: string; teacherId: string; room: string | null; section: string; sectionId: string } | null;
  overlays: DayOverlay[];
}

export interface DayView {
  date: string;
  weekday: number;
  scope: { kind: "section" | "teacher"; id: string } | null;
  banners: DayOverlay[];
  periods: DayPeriod[];
}

function isoWeekday(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

/** "VI-A" labels for section ids (grade code + section name). */
async function sectionLabels(ctx: TenantContext, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("class_sections").select("id, name, grades(code)").eq("institution_id", ctx.institution.id).in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id, `${(r.grades as { code: string } | null)?.code ?? "?"}-${r.name}`]));
}

/** "Mr Rao covers Maths" overlays from the substitution log for one date (latest row per substitution decides). */
async function activeCovers(ctx: TenantContext, versionId: string, date: string, scope: { kind: "section" | "teacher"; id: string }) {
  const supabase = await createClient();
  let query = supabase
    .from("timetable_changes")
    .select(CHANGE_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId)
    .eq("on_date", date)
    .not("substitution_id", "is", null)
    .order("created_at", { ascending: false });
  query = scope.kind === "section" ? query.eq("class_section_id", scope.id) : query.or(`teacher_id.eq.${scope.id},prev_teacher_id.eq.${scope.id}`);
  const { data, error } = await query;
  if (error) throw error;
  const latest = new Map<string, ChangeRow>();
  for (const row of (data as ChangeDbRow[]).map(toChange)) if (!latest.has(row.substitutionId!)) latest.set(row.substitutionId!, row);
  return [...latest.values()].filter((r) => r.action === "cover");
}

/** All a student or guardian is told about why a period is covered: never the leader's note or a leave. */
export const FAMILY_COVER_REASON = "The regular teacher is unavailable";

/** Covers in the caller's own (or child's) section on a date, via my_section_covers: who and which subject only. */
async function familyCovers(ctx: TenantContext, date: string, sectionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_section_covers", { p_institution_id: ctx.institution.id, p_date: date });
  if (error) throw error;
  return (data ?? []).filter((r) => r.class_section_id === sectionId);
}

/**
 * One day for one section or teacher: the regular published periods with
 * every overlay that changes them — substitutions, calendar holidays and
 * exam weeks, and edits made to the published timetable — each with its
 * reason, and an undo hook when the viewer holds timetable.manage.
 */
export async function timetableDay(ctx: TenantContext, input: DayViewInput): Promise<DayView> {
  const date = input.date ?? todayInInstitutionTimezone(ctx);
  const weekday = isoWeekday(date);
  const canManage = hasPermission(ctx, "timetable.manage");

  let scope: DayView["scope"] = null;
  if (input.teacherId) scope = { kind: "teacher", id: input.teacherId };
  else if (input.classSectionId) scope = { kind: "section", id: input.classSectionId };
  else if (input.studentId) {
    const sectionId = await activeSectionIdForStudent(ctx, input.studentId);
    if (sectionId) scope = { kind: "section", id: sectionId };
  } else if (ctx.membership.role === "teacher" && ctx.membership.staffId) scope = { kind: "teacher", id: ctx.membership.staffId };

  const supabase = await createClient();
  const [{ data: periodRows, error: periodsError }, versionId, events] = await Promise.all([
    supabase.from("periods").select("id, seq, name, starts_at, ends_at, is_break").eq("institution_id", ctx.institution.id).order("seq"),
    defaultPublishedVersionId(ctx),
    calendarForRole(ctx, { from: date, to: date }),
  ]);
  if (periodsError) throw periodsError;

  const banners: DayOverlay[] = events.map((e) => ({
    kind: e.kind === "holiday" ? "holiday" : e.kind === "exam_week" ? "exam" : "event",
    text: e.kind === "holiday" ? `No classes: ${e.title}` : e.kind === "exam_week" ? `Exam week: ${e.title}` : e.title,
    reason: e.description ?? (e.kind === "holiday" ? "School holiday on the academic calendar" : "On the academic calendar"),
  }));
  const holiday = banners.find((b) => b.kind === "holiday");
  const exam = banners.find((b) => b.kind === "exam");

  const periods: DayPeriod[] = (periodRows ?? []).map((p) => ({
    seq: p.seq,
    name: p.name,
    startsAt: toHHMM(p.starts_at),
    endsAt: toHHMM(p.ends_at),
    isBreak: p.is_break,
    regular: null,
    overlays: [],
  }));
  const bySeq = new Map(periods.map((p) => [p.seq, p]));
  const seqByPeriodId = new Map((periodRows ?? []).map((p) => [p.id, p.seq]));

  if (versionId && scope && weekday >= 1 && weekday <= 6) {
    const slots = await fetchSlots(ctx, versionId, { weekday, ...(scope.kind === "teacher" ? { teacherId: scope.id } : { classSectionId: scope.id }) });
    const sectionLabel = await sectionLabels(ctx, [...new Set(slots.map((s) => s.section.id))]);
    for (const s of slots) {
      const p = bySeq.get(s.period.seq);
      const section = sectionLabel.get(s.section.id) ?? s.section.name;
      if (p) p.regular = { subject: s.subject?.name ?? null, teacher: s.teacher.name, teacherId: s.teacher.id, room: s.room?.name ?? null, section, sectionId: s.section.id };
    }

    // Students and guardians cannot read substitution rows (0141 RLS); they get the fixed line.
    const family = !canManage && scope.kind === "section" && (ctx.membership.role === "student" || ctx.membership.role === "guardian");
    if (family) {
      for (const c of await familyCovers(ctx, date, scope.id)) {
        const p = bySeq.get(seqByPeriodId.get(c.period_id) ?? -1);
        if (p) p.overlays.push({ kind: "substitution", text: `Substitute: ${c.cover_teacher ?? "a teacher"} covers ${c.subject ?? "this period"}`, reason: FAMILY_COVER_REASON });
      }
    }

    for (const c of family ? [] : await activeCovers(ctx, versionId, date, scope)) {
      const p = bySeq.get(seqByPeriodId.get(c.periodId!) ?? -1);
      if (!p) continue;
      const subject = c.after?.subject ?? "this period";
      const covering = scope.kind === "teacher" && c.after?.teacherId === scope.id;
      p.overlays.push({
        kind: "substitution",
        text: covering ? `You cover ${subject} for ${c.before?.teacher ?? "a colleague"} (${c.label?.split(" · ")[0] ?? ""})` : `Substitute: ${c.after?.teacher ?? "a teacher"} covers ${subject}`,
        reason: c.reason,
        who: c.actorName,
        when: c.createdAt,
        changeId: c.id,
        ...(canManage ? { undo: "substitution" as const } : {}),
      });
    }

    if (scope.kind === "section") {
      const published = await supabase.from("timetable_versions").select("published_at").eq("id", versionId).maybeSingle();
      if (published.error) throw published.error;
      const since = published.data?.published_at ?? null;
      const latest = await latestCellChanges(ctx, versionId, scope.id);
      for (const c of latest.values()) {
        if (c.weekday !== weekday || !since || c.createdAt < since || c.kind === "publish") continue;
        const p = bySeq.get(seqByPeriodId.get(c.periodId!) ?? -1);
        if (!p) continue;
        p.overlays.push({
          kind: "changed",
          text: changeText(c),
          reason: c.reason,
          who: c.actorName,
          when: c.createdAt,
          changeId: c.id,
          ...(canManage ? { undo: "cell" as const } : {}),
        });
      }
    }
  }

  for (const p of periods) {
    if (p.isBreak) continue;
    if (holiday) p.overlays.unshift({ ...holiday, text: "No class (holiday)" });
    else if (exam && p.regular) p.overlays.unshift({ ...exam, text: "Exam week: the exam timetable may replace this period" });
  }

  return { date, weekday, scope, banners, periods };
}

/** "Maths · Ms Iyer · Room 6A → Science · Mr Rao · Lab 1" for a logged cell change. */
export function changeText(c: Pick<ChangeRow, "before" | "after" | "action">): string {
  const cell = (x: LoggedCell | null) => (x ? [x.subject, x.teacher, x.room].filter(Boolean).join(" · ") : "free period");
  if (c.action === "cover" || c.action === "uncover") return `${c.before?.teacher ?? "?"} → ${c.after?.teacher ?? "?"} (${c.after?.subject ?? c.before?.subject ?? ""})`;
  if (c.action === "publish" || c.action === "restore") return `${c.before?.name ?? "none"} → ${c.after?.name ?? "?"}`;
  if (c.action === "rules") return "Timetable rules changed";
  return `${cell(c.before)} → ${cell(c.after)}`;
}

/** The section's slots in a version as CellSlots (for snapshots and restore). */
export async function versionCells(ctx: TenantContext, versionId: string): Promise<CellSlot[]> {
  const supabase = await createClient();
  return loadAllSlots(supabase, ctx.institution.id, versionId);
}

export interface GridPeriod {
  id: string;
  seq: number;
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}

/** The bell schedule (every member reads periods). */
export async function gridPeriods(ctx: TenantContext): Promise<GridPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("periods")
    .select("id, seq, name, starts_at, ends_at, is_break")
    .eq("institution_id", ctx.institution.id)
    .order("seq");
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, seq: p.seq, name: p.name, startsAt: toHHMM(p.starts_at), endsAt: toHHMM(p.ends_at), isBreak: p.is_break }));
}

/** Subjects, active teaching staff and rooms for the editor and the rules page. Requires timetable.manage. */
export async function editOptions(ctx: TenantContext) {
  const supabase = await createClient();
  const id = ctx.institution.id;
  const [subjects, staff, rooms] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("institution_id", id).order("name"),
    supabase.from("staff").select("id, full_name").eq("institution_id", id).eq("status", "active").eq("is_teaching", true).order("full_name"),
    supabase.from("rooms").select("id, name").eq("institution_id", id).order("name"),
  ]);
  for (const r of [subjects, staff, rooms]) if (r.error) throw r.error;
  return {
    subjects: (subjects.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    teachers: (staff.data ?? []).map((s) => ({ id: s.id, name: s.full_name })),
    rooms: (rooms.data ?? []).map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * timetableTodayFor (the Today widget) plus 0141's reasons: a teacher's cover
 * periods appear ("Cover: Maths (VI-A)"), and a period that differs from the
 * regular one says why ("Substitute: Mr Rao covers Maths — Ms Iyer is on leave";
 * a student gets "— The regular teacher is unavailable" instead).
 */
export async function timetableTodayWithReasons(ctx: TenantContext): Promise<TimetablePeriod[]> {
  const periods = await timetableTodayFor(ctx);
  if (periods.length === 0) return periods;
  const role = ctx.membership.role;
  const scopeInput =
    role === "teacher" && ctx.membership.staffId
      ? { teacherId: ctx.membership.staffId }
      : role === "student" && ctx.membership.studentId
        ? { studentId: ctx.membership.studentId }
        : null;
  if (!scopeInput) return periods;
  const day = await timetableDay(ctx, scopeInput);
  const byStart = new Map(day.periods.map((p) => [p.startsAt, p]));
  return periods.map((p) => {
    const d = byStart.get(p.start);
    const o = d?.overlays[0];
    if (!d || !o) return p;
    const cover = o.kind === "substitution" && !d.regular;
    return { ...p, ...(cover ? { title: `Cover: ${o.text.replace(/^You cover /, "")}` } : {}), subtitle: `${cover ? "" : `${o.text} — `}${o.reason}` };
  });
}
