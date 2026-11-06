import "server-only";
// M07-T5 — timetable.* reads: the demoTimetable (src/components/widgets/
// timetable-widget.tsx) + fabric fixture (TimetableConflict/TeacherWorkload/
// RoomUtilisation, src/modules/fabric/types.ts) replacement. RLS (0069)
// already narrows visibility (guardian/student: published + own section
// only); the institution_id/version_id/etc filters below are defense in
// depth, same shape as every other queries.ts in this codebase. Mirrors
// src/modules/documents/queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { RoomUtilisation, TeacherWorkload, TimetableConflict } from "@/modules/fabric/types";
import type { TimetablePeriod } from "@/components/widgets/timetable-widget";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { approvedLeaveDates } from "@/modules/people/hr.queries";
import type { RoomSlot } from "@/modules/exams/schedule-conflicts";

const PAGE_SIZE = 1000;

/** PostgREST caps a response at max_rows (1000) — a 3,000-slot timetable came back truncated. Pages (caller orders by id) until a short page. */
async function allRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return out;
  }
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_MAX_PERIODS_WEEK = 36; // rulings: settings.timetable.max_periods_week, default 36

export function toHHMM(time: string): string {
  return time.slice(0, 5); // postgrest "time" -> "HH:MM:SS"
}

/** `fromIso` + `days` as an ISO date string (UTC calendar arithmetic, no tz shift). */
function addDaysIso(fromIso: string, days: number): string {
  const [y, m, d] = fromIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Institution-local weekday (0=Sun..6=Sat) and "HH:MM" — timezone source mirrors attendance/queries.ts's todayInInstitutionTimezone. */
function nowPartsInInstitutionTimezone(ctx: TenantContext): { weekday: number; hhmm: string } {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timeZone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const weekday = WEEKDAY_LABELS.indexOf(byType.get("weekday") ?? "Mon");
  return { weekday: weekday < 0 ? 1 : weekday, hhmm: `${byType.get("hour")}:${byType.get("minute")}` };
}

/** `settings.timetable.max_periods_week` — no schema field exists for it yet (core/schemas.ts is a different module's file; out of scope here), so a plain numeric default, same shortcut shape as settings.academic.max_section_size (0005 migration). */
export function maxPeriodsPerWeek(ctx: TenantContext): number {
  const timetable = ctx.institution.settings.timetable;
  const raw = typeof timetable === "object" && timetable !== null ? (timetable as Record<string, unknown>).max_periods_week : undefined;
  return typeof raw === "number" && raw > 0 ? raw : DEFAULT_MAX_PERIODS_WEEK;
}

/**
 * The most recently published version, or null if none. Not joined to
 * academic_years: guardians/students can't read that table (staff-only RLS),
 * and publishing archives the year's previous version, so the latest
 * published one is the current year's.
 */
export async function defaultPublishedVersionId(ctx: TenantContext): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export interface SectionTimetableSlot {
  weekday: number;
  period: { seq: number; name: string; startsAt: string; endsAt: string };
  subject: { id: string; name: string } | null;
  teacher: { id: string; name: string };
  room: { id: string; name: string } | null;
}

export interface TeacherTimetableSlot extends SectionTimetableSlot {
  section: { id: string; name: string };
}

function bySlot(a: SectionTimetableSlot, b: SectionTimetableSlot): number {
  return a.weekday - b.weekday || a.period.seq - b.period.seq;
}

/**
 * Shared slot fetch for forSection/forTeacher/forStudent/todayFor.
 * timetable_slots.subject_id (0069, amended) is the direct source of
 * subject — no subject_assignments inference needed.
 */
async function fetchSlots(
  ctx: TenantContext,
  versionId: string,
  filter: { classSectionId?: string; teacherId?: string; weekday?: number },
): Promise<TeacherTimetableSlot[]> {
  const supabase = await createClient();
  let query = supabase
    .from("timetable_slots")
    .select(
      "weekday, class_sections(id, name), subjects(id, name), staff(id, full_name), rooms(id, name), periods(seq, name, starts_at, ends_at)",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId);
  if (filter.classSectionId) query = query.eq("class_section_id", filter.classSectionId);
  if (filter.teacherId) query = query.eq("teacher_id", filter.teacherId);
  if (filter.weekday) query = query.eq("weekday", filter.weekday);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  return rows
    .map((row) => {
      const section = row.class_sections as { id: string; name: string } | null;
      const subject = row.subjects as { id: string; name: string } | null;
      const teacher = row.staff as { id: string; full_name: string } | null;
      const room = row.rooms as { id: string; name: string } | null;
      const period = row.periods as { seq: number; name: string; starts_at: string; ends_at: string } | null;
      return {
        weekday: row.weekday,
        period: {
          seq: period?.seq ?? 0,
          name: period?.name ?? "",
          startsAt: period ? toHHMM(period.starts_at) : "",
          endsAt: period ? toHHMM(period.ends_at) : "",
        },
        subject: subject ? { id: subject.id, name: subject.name } : null,
        teacher: { id: teacher?.id ?? "", name: teacher?.full_name ?? "" },
        room: room ? { id: room.id, name: room.name } : null,
        section: { id: section?.id ?? "", name: section?.name ?? "" },
      };
    })
    .sort(bySlot);
}

/** The weekly grid for one section (default version: the current year's published one). RLS further narrows guardian/student to their own section's published slots. */
export async function timetableForSection(
  ctx: TenantContext,
  classSectionId: string,
  versionId?: string,
): Promise<SectionTimetableSlot[]> {
  const version = versionId ?? (await defaultPublishedVersionId(ctx));
  if (!version) return [];
  const rows = await fetchSlots(ctx, version, { classSectionId });
  return rows.map((row) => ({ weekday: row.weekday, period: row.period, subject: row.subject, teacher: row.teacher, room: row.room }));
}

/** A teacher's own weekly grid (default: the caller's own staffId). */
export async function timetableForTeacher(
  ctx: TenantContext,
  staffId?: string,
  versionId?: string,
): Promise<TeacherTimetableSlot[]> {
  const teacherId = staffId ?? ctx.membership.staffId ?? undefined;
  if (!teacherId) return [];
  const version = versionId ?? (await defaultPublishedVersionId(ctx));
  if (!version) return [];
  return fetchSlots(ctx, version, { teacherId });
}

/** `studentId`'s active-enrolment section, or null; RLS decides visibility (a guardian outside that student's family reads no enrolment row at all). Shared by timetableForStudent and timetableTodayFor's studentId path. */
async function activeSectionIdForStudent(ctx: TenantContext, studentId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: enrolment, error } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return enrolment?.class_section_id ?? null;
}

/** A student's weekly grid, resolved via their own active enrolment section; RLS decides visibility (a guardian outside that student's family reads no enrolment row at all, so this returns empty rather than leaking). */
export async function timetableForStudent(ctx: TenantContext, studentId: string): Promise<SectionTimetableSlot[]> {
  const classSectionId = await activeSectionIdForStudent(ctx, studentId);
  if (!classSectionId) return [];
  return timetableForSection(ctx, classSectionId);
}

/** The guardian's first child (listMyChildren's own admission_no ordering) or the student's own active enrolment section; null for every other role. */
async function firstOwnSectionId(ctx: TenantContext): Promise<string | null> {
  const supabase = await createClient();

  if (ctx.membership.role === "student" && ctx.membership.studentId) {
    const { data, error } = await supabase
      .from("enrolments")
      .select("class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", ctx.membership.studentId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return data?.class_section_id ?? null;
  }

  if (ctx.membership.role === "guardian" && ctx.membership.guardianId) {
    const { data, error } = await supabase
      .from("guardian_students")
      .select("students(admission_no, enrolments(status, class_section_id))")
      .eq("institution_id", ctx.institution.id)
      .eq("guardian_id", ctx.membership.guardianId)
      .eq("portal_access", true);
    if (error) throw error;
    const children = (data ?? [])
      .map((row) => row.students as { admission_no: string; enrolments: { status: string; class_section_id: string }[] } | null)
      .filter((s): s is NonNullable<typeof s> => s != null)
      .sort((a, b) => a.admission_no.localeCompare(b.admission_no));
    const activeEnrolment = children[0]?.enrolments.find((e) => e.status === "active");
    return activeEnrolment?.class_section_id ?? null;
  }

  return null;
}

/**
 * Today's grid for the caller (studentId given: that student's section,
 * RLS-scoped; teacher: own slots, subtitle = section name; guardian/student:
 * first child/own section, subtitle = teacher name; every other role: the
 * bare bell schedule), breaks included, with isCurrent/isNext set — the
 * demoTimetable (timetable-widget.tsx) replacement. Sunday (weekday 0)
 * returns [].
 */
export async function timetableTodayFor(ctx: TenantContext, studentId?: string): Promise<TimetablePeriod[]> {
  const { weekday, hhmm } = nowPartsInInstitutionTimezone(ctx);
  if (weekday < 1 || weekday > 6) return [];

  const supabase = await createClient();
  const { data: periodRows, error: periodsError } = await supabase
    .from("periods")
    .select("seq, name, starts_at, ends_at, is_break")
    .eq("institution_id", ctx.institution.id)
    .order("seq");
  if (periodsError) throw periodsError;
  const periods = periodRows ?? [];
  if (periods.length === 0) return [];

  const version = await defaultPublishedVersionId(ctx);
  const slotsBySeq = new Map<number, TeacherTimetableSlot>();
  let isTeacherGrid = false;
  if (version) {
    let teacherId: string | null = null;
    let classSectionId: string | null = null;
    if (studentId) {
      classSectionId = await activeSectionIdForStudent(ctx, studentId);
    } else if (ctx.membership.role === "teacher") {
      teacherId = ctx.membership.staffId ?? null;
      isTeacherGrid = teacherId != null;
    } else {
      classSectionId = await firstOwnSectionId(ctx);
    }
    if (teacherId || classSectionId) {
      const rows = await fetchSlots(ctx, version, {
        weekday,
        ...(teacherId ? { teacherId } : { classSectionId: classSectionId as string }),
      });
      for (const row of rows) slotsBySeq.set(row.period.seq, row);
    }
  }

  const startsAt = periods.map((p) => toHHMM(p.starts_at));
  const endsAt = periods.map((p) => toHHMM(p.ends_at));
  const currentIdx = periods.findIndex((_p, i) => hhmm >= startsAt[i] && hhmm < endsAt[i]);
  const nextIdx = currentIdx >= 0 ? -1 : periods.findIndex((_p, i) => startsAt[i] > hhmm);

  return periods.map((p, i) => {
    const slot = slotsBySeq.get(p.seq);
    const timing = { start: startsAt[i], end: endsAt[i] };
    const base: TimetablePeriod = p.is_break
      ? { ...timing, title: p.name }
      : { ...timing, title: slot?.subject?.name ?? p.name, subtitle: isTeacherGrid ? slot?.section.name : slot?.teacher.name, room: slot?.room?.name };
    if (i === currentIdx) return { ...base, isCurrent: true };
    if (i === nextIdx) return { ...base, isNext: true };
    return base;
  });
}

/** room_capacity (room smaller than the section's active strength) + teacher_unavailable (over settings.timetable.max_periods_week) — double-booking can't occur, it's a DB constraint (0069 rulings). Requires timetable.manage. */
export async function timetableConflicts(ctx: TenantContext, versionId: string): Promise<TimetableConflict[]> {
  const supabase = await createClient();
  const rows = await allRows((from, to) =>
    supabase
      .from("timetable_slots")
      .select(
        "id, weekday, teacher_id, class_section_id, periods(seq), rooms(name, capacity), class_sections(name, grades(code))",
      )
      .eq("institution_id", ctx.institution.id)
      .eq("version_id", versionId)
      .order("id")
      .range(from, to),
  );
  if (rows.length === 0) return [];

  const sectionIds = [...new Set(rows.map((r) => r.class_section_id))];
  const enrolmentRows = await allRows((from, to) =>
    supabase
      .from("enrolments")
      .select("class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .in("class_section_id", sectionIds)
      .order("id")
      .range(from, to),
  );
  const strengthBySection = new Map<string, number>();
  for (const row of enrolmentRows) {
    strengthBySection.set(row.class_section_id, (strengthBySection.get(row.class_section_id) ?? 0) + 1);
  }

  const conflicts: TimetableConflict[] = [];
  for (const row of rows) {
    const room = row.rooms as { name: string; capacity: number } | null;
    if (!room) continue;
    const strength = strengthBySection.get(row.class_section_id) ?? 0;
    if (room.capacity >= strength) continue;
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    const period = row.periods as { seq: number } | null;
    conflicts.push({
      id: row.id,
      day: WEEKDAY_LABELS[row.weekday] ?? String(row.weekday),
      period: period?.seq ?? 0,
      kind: "room_capacity",
      entities: [room.name, `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`],
      suggestion: `${room.name} seats ${room.capacity}; section strength is ${strength} — move to a larger room.`,
    });
  }

  const maxPeriods = maxPeriodsPerWeek(ctx);
  const periodsByTeacher = new Map<string, number>();
  for (const row of rows) periodsByTeacher.set(row.teacher_id, (periodsByTeacher.get(row.teacher_id) ?? 0) + 1);
  const overloaded = [...periodsByTeacher.entries()].filter(([, n]) => n > maxPeriods);
  if (overloaded.length > 0) {
    const { data: teachers, error: teachersError } = await supabase
      .from("staff")
      .select("id, full_name")
      .in(
        "id",
        overloaded.map(([id]) => id),
      );
    if (teachersError) throw teachersError;
    const nameById = new Map((teachers ?? []).map((t) => [t.id, t.full_name]));
    for (const [teacherId, periodsWeek] of overloaded) {
      const name = nameById.get(teacherId) ?? teacherId;
      conflicts.push({
        id: `${versionId}:${teacherId}:overload`,
        day: "",
        period: 0,
        kind: "teacher_unavailable",
        entities: [name],
        suggestion: `${name} is scheduled for ${periodsWeek} periods/week, above the ${maxPeriods}/week limit — redistribute some sections.`,
      });
    }
  }

  return conflicts;
}

/** Per-teacher periods/week against settings.timetable.max_periods_week, for every teacher who has at least one slot in this version. subjects/sections are the distinct values across their actual slots (subject_id is direct on timetable_slots, 0069 amended — no subject_assignments inference needed). Requires timetable.manage. leave_dates (M08-T12) = approvedLeaveDates for today..today+13 (0070 leave_requests). */
export async function timetableTeacherWorkload(ctx: TenantContext, versionId: string): Promise<TeacherWorkload[]> {
  const supabase = await createClient();
  const rows = await allRows((from, to) =>
    supabase
      .from("timetable_slots")
      .select("teacher_id, subjects(name), class_sections(name, grades(code))")
      .eq("institution_id", ctx.institution.id)
      .eq("version_id", versionId)
      .order("id")
      .range(from, to),
  );
  if (rows.length === 0) return [];

  const teacherIds = [...new Set(rows.map((r) => r.teacher_id))];
  const { data: teachers, error: teachersError } = await supabase.from("staff").select("id, full_name").in("id", teacherIds);
  if (teachersError) throw teachersError;
  const nameById = new Map((teachers ?? []).map((t) => [t.id, t.full_name]));

  const maxPeriods = maxPeriodsPerWeek(ctx);
  const byTeacher = new Map<string, { periodsWeek: number; subjects: Set<string>; sections: Set<string> }>();
  for (const row of rows) {
    const subject = row.subjects as { name: string } | null;
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    const label = `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`;
    const entry = byTeacher.get(row.teacher_id) ?? { periodsWeek: 0, subjects: new Set<string>(), sections: new Set<string>() };
    entry.periodsWeek += 1;
    if (subject) entry.subjects.add(subject.name);
    entry.sections.add(label);
    byTeacher.set(row.teacher_id, entry);
  }

  const today = todayInInstitutionTimezone(ctx);
  const leaveByStaff = await approvedLeaveDates(ctx, teacherIds, today, addDaysIso(today, 13));

  return [...byTeacher.entries()].map(([staffId, entry]) => ({
    staff_id: staffId,
    name: nameById.get(staffId) ?? staffId,
    periods_week: entry.periodsWeek,
    max_periods: maxPeriods,
    subjects: [...entry.subjects],
    sections: [...entry.sections],
    leave_dates: leaveByStaff.get(staffId) ?? [],
  }));
}

/** Every room's usage in this version against the bell schedule (periods_total = 6 x non-break periods, rulings). Requires timetable.manage. */
export async function timetableRoomUtilisation(ctx: TenantContext, versionId: string): Promise<RoomUtilisation[]> {
  const supabase = await createClient();
  const [{ data: rooms, error: roomsError }, { count: nonBreakCount, error: periodsError }, slotRows] = await Promise.all([
    supabase.from("rooms").select("id, name, capacity").eq("institution_id", ctx.institution.id),
    supabase
      .from("periods")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", ctx.institution.id)
      .eq("is_break", false),
    allRows((from, to) =>
      supabase
        .from("timetable_slots")
        .select("room_id")
        .eq("institution_id", ctx.institution.id)
        .eq("version_id", versionId)
        .not("room_id", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (roomsError) throw roomsError;
  if (periodsError) throw periodsError;

  const periodsTotal = 6 * (nonBreakCount ?? 0);
  const usedByRoom = new Map<string, number>();
  for (const row of slotRows) {
    if (!row.room_id) continue;
    usedByRoom.set(row.room_id, (usedByRoom.get(row.room_id) ?? 0) + 1);
  }

  return (rooms ?? []).map((room) => ({
    room: room.name,
    capacity: room.capacity,
    periods_used: usedByRoom.get(room.id) ?? 0,
    periods_total: periodsTotal,
  }));
}

/** Non-break slots for the given rooms in the latest published version — exam-schedule-conflicts (M11-T7) checking a room's exam papers against the bell schedule. Empty `roomIds` or no published version short-circuits to []. */
export async function timetableRoomSlots(ctx: TenantContext, roomIds: string[]): Promise<RoomSlot[]> {
  if (roomIds.length === 0) return [];
  const versionId = await defaultPublishedVersionId(ctx);
  if (!versionId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_slots")
    .select(
      "weekday, room_id, class_sections(name, grades(code)), subjects(name), periods!inner(name, starts_at, ends_at, is_break)",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("version_id", versionId)
    .in("room_id", roomIds)
    .eq("periods.is_break", false);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    const subject = row.subjects as { name: string } | null;
    const period = row.periods as { name: string; starts_at: string; ends_at: string } | null;
    const sectionLabel = `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`;
    return {
      roomId: row.room_id as string,
      weekday: row.weekday,
      startsAt: period ? toHHMM(period.starts_at) : "",
      endsAt: period ? toHHMM(period.ends_at) : "",
      label: `${sectionLabel} ${subject?.name ?? ""} ${period?.name ?? ""}`.trim(),
    };
  });
}
