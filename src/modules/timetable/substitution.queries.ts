import "server-only";
// M08-T12 — timetable.coverNeeded / substitutionCandidates / substitutions
// reads (M08-tasks.md Task 12). RLS (0070) already narrows `substitutions`
// to admin-all-or-own-row; the institution_id filters below are defense in
// depth, same shape as every other queries.ts. substitutionCandidates
// mirrors assign_substitution's own candidate checks (migration 0070 part
// 2) so the picker only ever offers teachers the RPC would actually accept.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { staffUnavailableOn } from "@/modules/people/hr.queries";
import { defaultPublishedVersionId, loadRules, toHHMM } from "./queries";
import { rankSubstitutes } from "./checks";

interface PeriodInfo {
  seq: number;
  name: string;
  startsAt: string;
  endsAt: string;
}

interface NamedRef {
  id: string;
  name: string;
}

type PeriodRow = { seq: number; name: string; starts_at: string; ends_at: string } | null;

function toPeriodInfo(period: PeriodRow): PeriodInfo {
  return {
    seq: period?.seq ?? 0,
    name: period?.name ?? "",
    startsAt: period ? toHHMM(period.starts_at) : "",
    endsAt: period ? toHHMM(period.ends_at) : "",
  };
}

/** date's weekday as timetable_slots.weekday encodes it (1=Mon..6=Sat, JS getUTCDay() convention — matches the DB's extract(isodow from date) for every weekday a slot can have, since Sunday slots don't exist). */
function weekdayOfDate(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "VI-C", not the bare "C" every grade shares. */
function sectionLabel(s: { name: string; grades: { code: string } | null } | null | undefined): string {
  return s ? (s.grades?.code ? `${s.grades.code}-${s.name}` : s.name) : "";
}

export interface CoverNeededRow {
  slotId: string;
  date: string;
  period: PeriodInfo;
  section: NamedRef;
  subject: NamedRef | null;
  teacher: NamedRef;
  reason: "leave" | "absent";
  substitution: { id: string; substituteId: string; substituteName: string } | null;
}

/** Published slots on date's weekday whose teacher is unavailable (leave or absent that day). Requires timetable.manage. */
export async function timetableCoverNeeded(ctx: TenantContext, date?: string): Promise<CoverNeededRow[]> {
  const targetDate = date ?? todayInInstitutionTimezone(ctx);
  const version = await defaultPublishedVersionId(ctx);
  if (!version) return [];

  const supabase = await createClient();
  const { data: slotRows, error } = await supabase
    .from("timetable_slots")
    .select("id, teacher_id, class_sections(id, name, grades(code)), subjects(id, name), staff(id, full_name), periods(seq, name, starts_at, ends_at)")
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", version)
    .eq("weekday", weekdayOfDate(targetDate));
  if (error) throw error;
  const slots = slotRows ?? [];
  if (slots.length === 0) return [];

  const unavailable = await staffUnavailableOn(ctx, targetDate);
  const relevant = slots.filter((row) => unavailable.has(row.teacher_id));
  if (relevant.length === 0) return [];

  const slotIds = relevant.map((row) => row.id);
  const { data: subRows, error: subError } = await supabase
    .from("substitutions")
    .select("id, slot_id, substitute_teacher_id, substitute:staff!substitute_teacher_id(full_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("date", targetDate)
    .eq("status", "assigned")
    .in("slot_id", slotIds);
  if (subError) throw subError;
  const subBySlot = new Map((subRows ?? []).map((row) => [row.slot_id, row]));

  return relevant.map((row) => {
    const section = row.class_sections as { id: string; name: string; grades: { code: string } | null } | null;
    const subject = row.subjects as { id: string; name: string } | null;
    const teacher = row.staff as { id: string; full_name: string } | null;
    const sub = subBySlot.get(row.id);
    const substitute = sub?.substitute as { full_name: string } | null;
    return {
      slotId: row.id,
      date: targetDate,
      period: toPeriodInfo(row.periods as PeriodRow),
      section: { id: section?.id ?? "", name: sectionLabel(section) },
      subject: subject ? { id: subject.id, name: subject.name } : null,
      teacher: { id: teacher?.id ?? "", name: teacher?.full_name ?? "" },
      reason: unavailable.get(row.teacher_id) ?? "absent",
      substitution: sub ? { id: sub.id, substituteId: sub.substitute_teacher_id, substituteName: substitute?.full_name ?? "" } : null,
    };
  });
}

export interface SubstitutionCandidateRow {
  staffId: string;
  name: string;
  periodsWeek: number;
  maxPeriods: number;
  /** 0141: rank score under rules.substitute_ranking (0 when the rule is off) and the facts behind it. */
  score: number;
  why: string;
}

/**
 * Active is_teaching staff, not the slot teacher, free at that weekday/period
 * in the slot's version, with no assigned substitution at (date, period) and
 * not unavailable (leave/absent) on the date — the same candidate rules
 * assign_substitution itself enforces (0070 part 2), so the picker never
 * offers a teacher the RPC would reject. Sorted by periodsWeek ascending,
 * then name — or, with 0141's substitute_ranking rule on, by its points
 * (same subject, same grade, fewest periods that day, not covering), each
 * row saying why. Requires timetable.manage.
 */
export async function timetableSubstitutionCandidates(ctx: TenantContext, slotId: string, date: string): Promise<SubstitutionCandidateRow[]> {
  const supabase = await createClient();
  const { data: slot, error: slotError } = await supabase
    .from("timetable_slots")
    .select("id, version_id, teacher_id, weekday, period_id, subject_id, subjects(name), class_sections(grade_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("id", slotId)
    .maybeSingle();
  if (slotError) throw slotError;
  if (!slot) return [];

  const { data: staffRows, error: staffError } = await supabase
    .from("staff")
    .select("id, full_name")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .eq("is_teaching", true)
    .neq("id", slot.teacher_id);
  if (staffError) throw staffError;
  const candidates = staffRows ?? [];
  if (candidates.length === 0) return [];
  const candidateIds = candidates.map((row) => row.id);

  const unavailable = await staffUnavailableOn(ctx, date);

  const { data: busyRows, error: busyError } = await supabase
    .from("timetable_slots")
    .select("teacher_id")
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", slot.version_id)
    .eq("weekday", slot.weekday)
    .eq("period_id", slot.period_id)
    .in("teacher_id", candidateIds);
  if (busyError) throw busyError;
  const busy = new Set((busyRows ?? []).map((row) => row.teacher_id));

  const { data: assignedRows, error: assignedError } = await supabase
    .from("substitutions")
    .select("substitute_teacher_id")
    .eq("institution_id", ctx.institution.id)
    .eq("date", date)
    .eq("period_id", slot.period_id)
    .eq("status", "assigned")
    .in("substitute_teacher_id", candidateIds);
  if (assignedError) throw assignedError;
  const assigned = new Set((assignedRows ?? []).map((row) => row.substitute_teacher_id));

  const free = candidates.filter((row) => !busy.has(row.id) && !assigned.has(row.id) && !unavailable.has(row.id));
  if (free.length === 0) return [];

  const freeIds = free.map((row) => row.id);
  const [loadResult, taughtResult, coveringResult, rules] = await Promise.all([
    supabase.from("timetable_slots").select("teacher_id, weekday").eq("institution_id", ctx.institution.id).eq("version_id", slot.version_id).in("teacher_id", freeIds),
    supabase.from("subject_assignments").select("teacher_id, subject_id, class_sections(grade_id)").eq("institution_id", ctx.institution.id).in("teacher_id", freeIds),
    supabase.from("substitutions").select("substitute_teacher_id").eq("institution_id", ctx.institution.id).eq("date", date).eq("status", "assigned").in("substitute_teacher_id", freeIds),
    loadRules(ctx),
  ]);
  if (loadResult.error) throw loadResult.error;
  if (taughtResult.error) throw taughtResult.error;
  if (coveringResult.error) throw coveringResult.error;
  const periodsByTeacher = new Map<string, number>();
  const todayByTeacher = new Map<string, number>();
  for (const row of loadResult.data ?? []) {
    periodsByTeacher.set(row.teacher_id, (periodsByTeacher.get(row.teacher_id) ?? 0) + 1);
    if (row.weekday === slot.weekday) todayByTeacher.set(row.teacher_id, (todayByTeacher.get(row.teacher_id) ?? 0) + 1);
  }
  const gradeId = (slot.class_sections as { grade_id: string } | null)?.grade_id;
  const teachesSubject = new Set((taughtResult.data ?? []).filter((r) => r.subject_id === slot.subject_id).map((r) => r.teacher_id));
  const teachesGrade = new Set(
    (taughtResult.data ?? []).filter((r) => (r.class_sections as { grade_id: string } | null)?.grade_id === gradeId).map((r) => r.teacher_id),
  );
  const covering = new Map<string, number>();
  for (const row of coveringResult.data ?? []) covering.set(row.substitute_teacher_id, (covering.get(row.substitute_teacher_id) ?? 0) + 1);

  const maxPeriods = rules.max_teacher_per_week.value;
  const ranked = rankSubstitutes(
    free.map((row) => ({
      staffId: row.id,
      name: row.full_name,
      periodsWeek: periodsByTeacher.get(row.id) ?? 0,
      periodsToday: todayByTeacher.get(row.id) ?? 0,
      teachesSubject: teachesSubject.has(row.id),
      teachesGrade: teachesGrade.has(row.id),
      coveringToday: covering.get(row.id) ?? 0,
    })),
    rules,
    (slot.subjects as { name: string } | null)?.name,
  );
  return ranked.map((c) => ({ staffId: c.staffId, name: c.name, periodsWeek: c.periodsWeek, maxPeriods, score: c.score, why: c.why }));
}

export interface SubstitutionListRow {
  id: string;
  date: string;
  period: PeriodInfo;
  section: NamedRef;
  subject: NamedRef | null;
  originalTeacher: NamedRef;
  substituteTeacher: NamedRef;
  status: "assigned" | "cancelled";
}

/** Assigned substitutions on `date` that RLS shows (admin: all; a teacher: rows where they are the original or substitute teacher). Requires timetable.read. */
export async function timetableSubstitutions(ctx: TenantContext, date?: string): Promise<SubstitutionListRow[]> {
  const targetDate = date ?? todayInInstitutionTimezone(ctx);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("substitutions")
    .select(
      "id, date, status, periods(seq, name, starts_at, ends_at), timetable_slots(class_sections(id, name, grades(code)), subjects(id, name)), original_teacher:staff!original_teacher_id(id, full_name), substitute_teacher:staff!substitute_teacher_id(id, full_name)",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("date", targetDate)
    .eq("status", "assigned")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const slot = row.timetable_slots as {
      class_sections: { id: string; name: string; grades: { code: string } | null } | null;
      subjects: { id: string; name: string } | null;
    } | null;
    const original = row.original_teacher as { id: string; full_name: string } | null;
    const substitute = row.substitute_teacher as { id: string; full_name: string } | null;
    return {
      id: row.id,
      date: row.date,
      period: toPeriodInfo(row.periods as PeriodRow),
      section: { id: slot?.class_sections?.id ?? "", name: sectionLabel(slot?.class_sections) },
      subject: slot?.subjects ? { id: slot.subjects.id, name: slot.subjects.name } : null,
      originalTeacher: { id: original?.id ?? "", name: original?.full_name ?? "" },
      substituteTeacher: { id: substitute?.id ?? "", name: substitute?.full_name ?? "" },
      status: row.status as "assigned" | "cancelled",
    };
  });
}
