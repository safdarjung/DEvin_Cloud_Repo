import "server-only";
// T-015 — attendance module reads (06 §W5). Always the signed-in user's RLS
// client (CLAUDE.md), with the same class-teacher narrowing as actions.ts
// for "which sections can I mark" (listing scope should match write scope).
import { AppError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

/** Institution-local calendar date (same approach as actions.ts's own `todayInTimezone` — not the server's UTC date). Exported for src/modules/people/hr.queries.ts (M08-T11 rulings §Queries). */
export function todayInInstitutionTimezone(ctx: TenantContext): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timezone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export interface AttendanceStatusOption {
  code: string;
  label: string;
  countsPresent: number;
  inDenominator: boolean;
  notifyGuardian: boolean;
}

/** Parsed `settings.attendance`, or safe defaults if settings don't parse. */
export function getAttendanceSettings(ctx: TenantContext): {
  mode: string;
  correctionWindowDays: number;
  statuses: AttendanceStatusOption[];
  thresholds: { warn: number; critical: number };
} {
  const parsed = InstitutionSettingsSchema.shape.attendance.safeParse(ctx.institution.settings.attendance);
  if (!parsed.success) return { mode: "daily", correctionWindowDays: 0, statuses: [], thresholds: { warn: 80, critical: 75 } };
  return {
    mode: parsed.data.mode,
    correctionWindowDays: parsed.data.correction_window_days,
    statuses: parsed.data.statuses.map((s) => ({
      code: s.code,
      label: s.label,
      countsPresent: s.counts_present,
      inDenominator: s.in_denominator,
      notifyGuardian: s.notify_guardian ?? false,
    })),
    thresholds: { warn: parsed.data.alert_thresholds.warn, critical: parsed.data.alert_thresholds.critical },
  };
}

export interface SectionOption {
  id: string;
  label: string;
  classTeacherId: string | null;
}

/** Sections to offer under `/attendance`: owner/principal/admin see all, a teacher sees only sections they are the CLASS teacher of (narrower than `app.teaches_section` — matches actions.ts). */
export async function getTodaySectionsForTeacher(ctx: TenantContext): Promise<SectionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, name, class_teacher_id, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  let rows = data ?? [];

  if (ctx.membership.role === "teacher" && ctx.membership.staffId) {
    rows = rows.filter((row) => row.class_teacher_id === ctx.membership.staffId);
  }

  return rows.map((row) => ({
    id: row.id,
    label: `${(row.grades as { code: string } | null)?.code ?? "?"}-${row.name}`,
    classTeacherId: row.class_teacher_id,
  }));
}

export interface AttendanceStudentRow {
  studentId: string;
  name: string;
  rollNo: number | null;
  /** attendance_records.id for this student's row in this session, or null if not yet marked. */
  recordId: string | null;
  status: string | null;
  note: string | null;
}

export interface SessionRegister {
  section: SectionOption;
  date: string;
  session: { id: string; status: "open" | "submitted"; submittedAt: string | null } | null;
  students: AttendanceStudentRow[];
}

/** The register for one section/date (06 §W5) — enrolled students plus any existing session/records for that date. */
export async function getSession(ctx: TenantContext, classSectionId: string, date: string): Promise<SessionRegister | null> {
  const supabase = await createClient();

  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("id, name, class_teacher_id, grades(code)")
    .eq("id", classSectionId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (sectionError) throw sectionError;
  if (!section) return null;

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, roll_no, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false });
  if (enrolError) throw enrolError;

  const { data: sessionRow, error: sessionReadError } = await supabase
    .from("attendance_sessions")
    .select("id, status, submitted_at")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("date", date)
    .is("period_id", null)
    .maybeSingle();
  if (sessionReadError) throw sessionReadError;

  const recordsByStudent = new Map<string, { id: string; status: string; note: string | null }>();
  if (sessionRow) {
    const { data: records, error: recordsError } = await supabase
      .from("attendance_records")
      .select("id, student_id, status, note")
      .eq("institution_id", ctx.institution.id)
      .eq("session_id", sessionRow.id);
    if (recordsError) throw recordsError;
    for (const r of records ?? []) {
      recordsByStudent.set(r.student_id, { id: r.id, status: r.status, note: r.note });
    }
  }

  const students: AttendanceStudentRow[] = (enrolments ?? []).map((e) => {
    const student = e.students as { first_name: string; last_name: string | null } | null;
    const record = recordsByStudent.get(e.student_id);
    return {
      studentId: e.student_id,
      name: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      rollNo: e.roll_no,
      recordId: record?.id ?? null,
      status: record?.status ?? null,
      note: record?.note ?? null,
    };
  });

  return {
    section: {
      id: section.id,
      label: `${(section.grades as { code: string } | null)?.code ?? "?"}-${section.name}`,
      classTeacherId: section.class_teacher_id,
    },
    date,
    session: sessionRow
      ? { id: sessionRow.id, status: sessionRow.status as "open" | "submitted", submittedAt: sessionRow.submitted_at }
      : null,
    students,
  };
}

/** Pure percentage math (AC5) over pre-counted rows — the aggregate shape `attendance_daily_counts` (M16-T3) returns. Isolated so it can be unit-tested without a DB. */
export function percentageFromCounts(
  rows: { status: string; n: number }[],
  statuses: Pick<AttendanceStatusOption, "code" | "countsPresent" | "inDenominator">[],
): { percentage: number; presentWeighted: number; totalInDenominator: number } {
  const byCode = new Map(statuses.map((s) => [s.code, s]));
  let presentWeighted = 0;
  let totalInDenominator = 0;

  for (const row of rows) {
    const status = byCode.get(row.status);
    if (!status || !status.inDenominator) continue;
    totalInDenominator += row.n;
    presentWeighted += status.countsPresent * row.n;
  }

  const percentage = totalInDenominator === 0 ? 0 : Math.round((presentWeighted / totalInDenominator) * 10000) / 100;
  return { percentage, presentWeighted, totalInDenominator };
}

/** Pure percentage math (AC5) over one record per status code — delegates to percentageFromCounts (M16-T4). */
export function computeAttendancePercentage(
  statusCodes: string[],
  statuses: Pick<AttendanceStatusOption, "code" | "countsPresent" | "inDenominator">[],
): { percentage: number; presentWeighted: number; totalInDenominator: number } {
  const counts = new Map<string, number>();
  for (const code of statusCodes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return percentageFromCounts(Array.from(counts, ([status, n]) => ({ status, n })), statuses);
}

export interface StudentAttendanceSummary {
  studentId: string;
  termId: string;
  percentage: number;
  presentWeighted: number;
  totalInDenominator: number;
  thresholds: { warn: number; critical: number };
}

/** 06 §W5 / AC5 — a student's attendance % for a term, weighted per `settings.attendance.statuses`. Exported for the portal and the student profile. */
export async function getStudentAttendanceSummary(
  ctx: TenantContext,
  studentId: string,
  termId: string,
): Promise<StudentAttendanceSummary> {
  const supabase = await createClient();
  const settings = getAttendanceSettings(ctx);

  const { data: term, error: termError } = await supabase
    .from("terms")
    .select("starts_on, ends_on")
    .eq("id", termId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (termError) throw termError;
  // Another school's or a made-up term answered "0% attendance".
  if (!term) throw new AppError("not_found", "Term not found.");

  const { data: records, error: recordsError } = await supabase
    .from("attendance_records")
    .select("status, attendance_sessions!inner(date)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .is("attendance_sessions.period_id", null)
    .gte("attendance_sessions.date", term.starts_on)
    .lte("attendance_sessions.date", term.ends_on);
  if (recordsError) throw recordsError;

  const { percentage, presentWeighted, totalInDenominator } = computeAttendancePercentage(
    (records ?? []).map((r) => r.status),
    settings.statuses,
  );

  return {
    studentId,
    termId,
    percentage,
    presentWeighted,
    totalInDenominator,
    thresholds: settings.thresholds,
  };
}

// dashboard — T-039 / M16-T4. All three queries below read through
// `attendanceDailyCounts` (RPC to M16-T3's `public.attendance_daily_counts`)
// rather than selecting raw `attendance_records` rows: `supabase/config.toml`
// `max_rows = 1000` silently truncates a row-level read once the seeded
// tenant's daily mark count passes it (06 M16 rulings, "0078").

export interface AttendanceDailyCountRow {
  date: string;
  classSectionId: string | null;
  status: string;
  n: number;
}

/** RPC wrapper over `public.attendance_daily_counts` (security invoker — RLS on attendance_records/attendance_sessions is the only filter, M16-T3). */
export async function attendanceDailyCounts(
  ctx: TenantContext,
  params: { from: string; to: string; classSectionId?: string; studentId?: string; bySection?: boolean },
): Promise<AttendanceDailyCountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_daily_counts", {
    p_institution_id: ctx.institution.id,
    p_from: params.from,
    p_to: params.to,
    p_class_section_id: params.classSectionId,
    p_student_id: params.studentId,
    p_by_section: params.bySection,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    date: r.date,
    classSectionId: r.class_section_id,
    status: r.status,
    n: r.n,
  }));
}

/**
 * Whole students per status for a day. A half day is one student marked "Half day", never 0.5 of a
 * student: the weighted sum is only for the percentage. (The AI once said "72.5 present out of 84".)
 */
export interface AttendanceHeadCounts {
  /** Students marked with a status that counts toward the percentage. */
  studentsMarked: number;
  /** Full day present (Present, Late and any status counting fully present). */
  present: number;
  /** Partly present, e.g. Half day. */
  halfDay: number;
  /** Absent for the day. */
  absent: number;
  /** Marked with a status left out of the percentage, e.g. leave. */
  notCounted: number;
  /** Students per status as the school names them, e.g. [{ status: "Absent", students: 11 }]. */
  byStatus: { status: string; students: number }[];
}

export function headCounts(
  rows: { status: string; n: number }[],
  statuses: Pick<AttendanceStatusOption, "code" | "label" | "countsPresent" | "inDenominator">[],
): AttendanceHeadCounts {
  const byCode = new Map(statuses.map((s) => [s.code, s]));
  const out: AttendanceHeadCounts = { studentsMarked: 0, present: 0, halfDay: 0, absent: 0, notCounted: 0, byStatus: [] };
  const perLabel = new Map<string, number>();
  for (const row of rows) {
    const s = byCode.get(row.status);
    perLabel.set(s?.label ?? row.status, (perLabel.get(s?.label ?? row.status) ?? 0) + row.n);
    if (!s || !s.inDenominator) {
      out.notCounted += row.n;
      continue;
    }
    out.studentsMarked += row.n;
    if (s.countsPresent >= 1) out.present += row.n;
    else if (s.countsPresent > 0) out.halfDay += row.n;
    else out.absent += row.n;
  }
  out.byStatus = [...perLabel.entries()].map(([status, students]) => ({ status, students })).sort((a, b) => b.students - a.students);
  return out;
}

export interface AttendanceTodaySummary extends AttendanceHeadCounts {
  date: string;
  /** Attendance % (a half day counts half). 0 when nothing is marked yet. */
  percentage: number;
}

/** Institution-wide attendance for today, across all sections: % plus whole-student head counts. */
export async function attendanceTodaySummary(ctx: TenantContext): Promise<AttendanceTodaySummary> {
  const settings = getAttendanceSettings(ctx);
  const date = todayInInstitutionTimezone(ctx);

  const rows = await attendanceDailyCounts(ctx, { from: date, to: date });
  const { percentage } = percentageFromCounts(rows, settings.statuses);

  return { date, percentage, ...headCounts(rows, settings.statuses) };
}

export interface SectionAttendanceAlert {
  classSectionId: string;
  label: string;
  percentage: number;
}

/** Sections at/below `settings.attendance.alert_thresholds.critical` today, worst first. */
export async function sectionsBelowThreshold(ctx: TenantContext): Promise<SectionAttendanceAlert[]> {
  const supabase = await createClient();
  const settings = getAttendanceSettings(ctx);
  const date = todayInInstitutionTimezone(ctx);

  const rows = await attendanceDailyCounts(ctx, { from: date, to: date, bySection: true });

  const bySection = new Map<string, { status: string; n: number }[]>();
  for (const row of rows) {
    if (!row.classSectionId) continue;
    const entry = bySection.get(row.classSectionId) ?? [];
    entry.push({ status: row.status, n: row.n });
    bySection.set(row.classSectionId, entry);
  }
  if (bySection.size === 0) return [];

  const { data: sections, error } = await supabase
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .in("id", Array.from(bySection.keys()));
  if (error) throw error;
  const labelById = new Map(
    (sections ?? []).map((s) => [s.id, `${(s.grades as { code: string } | null)?.code ?? "?"}-${s.name}`]),
  );

  return Array.from(bySection.entries())
    .map(([classSectionId, counts]) => ({
      classSectionId,
      label: labelById.get(classSectionId) ?? "?",
      percentage: percentageFromCounts(counts, settings.statuses).percentage,
    }))
    .filter((s) => s.percentage < settings.thresholds.critical)
    .sort((a, b) => a.percentage - b.percentage);
}

export interface TrendPoint {
  label: string;
  value: number;
}

/** UTC-safe calendar-date arithmetic — dates are plain "YYYY-MM-DD", never institution-local wall-clock time, so a UTC offset can't shift the day. */
function addDaysUTC(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** "d MMM" en-IN, e.g. "28 Oct" (06 M16 rulings, "Trend"). */
function trendLabel(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/**
 * `days` calendar days ending today (institution-local), one point per date
 * with at least one in-denominator record — holidays/Sundays/unmarked days
 * are skipped. With `studentId`, each point is the running % from the
 * window start to that date (06 M16 rulings, "Trend"); otherwise each point
 * is that date's own %. Scope: `classSectionId`/`studentId` narrow the RPC
 * call, same as `attendanceDailyCounts`; with neither, RLS alone decides
 * what the caller sees.
 */
export async function attendanceTrend(
  ctx: TenantContext,
  params: { days?: number; classSectionId?: string; studentId?: string },
): Promise<TrendPoint[]> {
  const settings = getAttendanceSettings(ctx);
  const days = params.days ?? 30;
  const to = todayInInstitutionTimezone(ctx);
  const from = addDaysUTC(to, -(days - 1));

  const rows = await attendanceDailyCounts(ctx, {
    from,
    to,
    classSectionId: params.classSectionId,
    studentId: params.studentId,
  });

  const byDate = new Map<string, { status: string; n: number }[]>();
  for (const row of rows) {
    const entry = byDate.get(row.date) ?? [];
    entry.push({ status: row.status, n: row.n });
    byDate.set(row.date, entry);
  }
  const dates = Array.from(byDate.keys()).sort();

  const points: TrendPoint[] = [];
  let running: { status: string; n: number }[] = [];
  for (const date of dates) {
    const dayRows = byDate.get(date) ?? [];
    if (params.studentId) running = running.concat(dayRows);
    const { percentage, totalInDenominator } = percentageFromCounts(params.studentId ? running : dayRows, settings.statuses);
    if (totalInDenominator === 0) continue;
    // 06 M16 rulings, "Trend" — 1 decimal (not percentageFromCounts' 2, used elsewhere for finer rollups).
    points.push({ label: trendLabel(date), value: Math.round(percentage * 10) / 10 });
  }
  return points;
}

// New — attendance-pattern-insight AI feature (sits beside
// `StudentAttendanceSummary`'s existing static threshold badge; does not
// replace it). `AttendanceStudentPattern` carries the student's name for
// this module's own server-side rendering ONLY — it must never be passed
// to anything that talks to the AI gateway. `buildAnonymizedAttendancePatterns`
// is the one function allowed to cross that boundary: it strips every
// field except a position-based `index` and plain numbers/booleans.
// Widening `AnonymizedAttendancePattern` to carry a name/id is the thing a
// reviewer should catch, same discipline as `modules/ai/prompts/quiz.ts`.

export interface AttendanceStudentPattern {
  studentId: string;
  name: string;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  /** Partly present days, e.g. Half day (0 < counts present < 1). */
  halfDayCount: number;
  /** Day-offsets (0 = most recent school day) among the last `RECENT_SCHOOL_DAYS` school days this student was not fully present. */
  recentAbsentDayOffsets: number[];
}

export interface AnonymizedAttendancePattern {
  index: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  recentAbsentDayOffsets: number[];
}

/** Pure, PII-free projection — this is the exact shape ever serialized into the AI request body. */
export function buildAnonymizedAttendancePatterns(
  students: readonly AttendanceStudentPattern[],
): AnonymizedAttendancePattern[] {
  return students.map((student, index) => ({
    index,
    presentCount: student.presentCount,
    absentCount: student.absentCount,
    lateCount: student.lateCount,
    recentAbsentDayOffsets: [...student.recentAbsentDayOffsets],
  }));
}

export interface SectionAttendancePatterns {
  classTeacherId: string | null;
  students: AttendanceStudentPattern[];
}

const RECENT_SCHOOL_DAYS = 10;
// Defensive match with the route's own cap (DBT-style lesson 9: bound
// array-of-object inputs) — this is not itself the enforcement point.
const MAX_PATTERN_STUDENTS = 60;

/**
 * Per-enrolled-student attendance counts for a term, plus which of the
 * last `RECENT_SCHOOL_DAYS` school days (for this section) were days the
 * student was not fully present — the source data for the
 * attendance-pattern-insight AI feature. Returns `null` only when the
 * section itself doesn't exist/isn't in this institution; an unknown term
 * returns an empty student list rather than throwing, same shape either way.
 */
export async function getSectionAttendancePatterns(
  ctx: TenantContext,
  classSectionId: string,
  termId: string,
): Promise<SectionAttendancePatterns | null> {
  const supabase = await createClient();
  const settings = getAttendanceSettings(ctx);
  const byCode = new Map(settings.statuses.map((s) => [s.code, s]));

  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("id, class_teacher_id")
    .eq("id", classSectionId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (sectionError) throw sectionError;
  if (!section) return null;

  const { data: term, error: termError } = await supabase
    .from("terms")
    .select("starts_on, ends_on")
    .eq("id", termId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (termError) throw termError;
  if (!term) return { classTeacherId: section.class_teacher_id, students: [] };

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false });
  if (enrolError) throw enrolError;
  const enrolmentRows = (enrolments ?? []).slice(0, MAX_PATTERN_STUDENTS);

  const { data: sessions, error: sessionsError } = await supabase
    .from("attendance_sessions")
    .select("id, date")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .is("period_id", null)
    .gte("date", term.starts_on)
    .lte("date", term.ends_on)
    .order("date", { ascending: false });
  if (sessionsError) throw sessionsError;
  const allSessions = sessions ?? [];
  const recentOffsetBySessionId = new Map(
    allSessions.slice(0, RECENT_SCHOOL_DAYS).map((s, offset) => [s.id as string, offset]),
  );

  const sessionIds = allSessions.map((s) => s.id);
  const recordsByStudent = new Map<string, { sessionId: string; status: string }[]>();
  if (sessionIds.length > 0) {
    // Fix round 1 (security review, MED-4): PostgREST defaults to a 1,000-row
    // page — without `.range()`, a term with >1,000 attendance_records for
    // this section (the seeded demo tenant already has 1,764/section for
    // Term 1) silently returned only the first 1,000, in no fixed order, so
    // counts/recent-offsets were wrong for whichever students happened to
    // fall outside that page. Same fix shape as the T-043 invoice-generation
    // job (`src/modules/jobs/handlers/finance.generate_term_invoices.ts`):
    // paged with an explicit stable `order("id")` rather than aggregated in
    // SQL — a grouped-select/view would need a new migration, and this
    // packet is not DB owner this round (no migrations).
    const PAGE_SIZE = 1000;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: recordsError } = await supabase
        .from("attendance_records")
        .select("student_id, session_id, status")
        .eq("institution_id", ctx.institution.id)
        .in("session_id", sessionIds)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (recordsError) throw recordsError;
      for (const r of page ?? []) {
        const list = recordsByStudent.get(r.student_id) ?? [];
        list.push({ sessionId: r.session_id, status: r.status });
        recordsByStudent.set(r.student_id, list);
      }
      if (!page || page.length < PAGE_SIZE) break;
    }
  }

  const students: AttendanceStudentPattern[] = enrolmentRows.map((e) => {
    const student = e.students as { first_name: string; last_name: string | null } | null;
    const name = [student?.first_name, student?.last_name].filter(Boolean).join(" ");
    const records = recordsByStudent.get(e.student_id) ?? [];

    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let halfDayCount = 0;
    const recentAbsentDayOffsets: number[] = [];

    for (const r of records) {
      const status = byCode.get(r.status);
      if (!status || !status.inDenominator) continue;
      const fullyPresent = status.countsPresent >= 1;
      // Late is decided by the school's label ("Late"): the code is short ("L").
      const isLate = /\blate\b/i.test(status.label);

      if (isLate) lateCount += 1;
      else if (fullyPresent) presentCount += 1;
      else if (status.countsPresent > 0) halfDayCount += 1;
      else absentCount += 1;

      if (!fullyPresent) {
        const offset = recentOffsetBySessionId.get(r.sessionId);
        if (offset !== undefined) recentAbsentDayOffsets.push(offset);
      }
    }

    return {
      studentId: e.student_id,
      name,
      presentCount,
      absentCount,
      lateCount,
      halfDayCount,
      recentAbsentDayOffsets: recentAbsentDayOffsets.sort((a, b) => a - b),
    };
  });

  return { classTeacherId: section.class_teacher_id, students };
}

// M08-T10 — period attendance summary (06 §W5 extension, timetable.manage's
// substitution dialog and the teacher's own period register both read this).
// RLS on attendance_sessions/attendance_records (06 §2.2, DBT-49) decides
// which sessions are visible to the caller; this function does not add its
// own narrowing on top.

export interface PeriodSummaryRow {
  periodId: string;
  seq: number;
  name: string;
  startsAt: string;
  endsAt: string;
  sessionId: string | null;
  counts: Record<string, number>;
}

/** Every non-break period of the institution, with this section/date's session (if marked) and its status counts. */
export async function periodSummary(
  ctx: TenantContext,
  classSectionId: string,
  date: string,
): Promise<PeriodSummaryRow[]> {
  const supabase = await createClient();

  const { data: periods, error: periodsError } = await supabase
    .from("periods")
    .select("id, seq, name, starts_at, ends_at")
    .eq("institution_id", ctx.institution.id)
    .eq("is_break", false)
    .order("seq");
  if (periodsError) throw periodsError;
  const periodRows = periods ?? [];
  if (periodRows.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from("attendance_sessions")
    .select("id, period_id")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("date", date)
    .in(
      "period_id",
      periodRows.map((p) => p.id),
    );
  if (sessionsError) throw sessionsError;
  const sessionRows = sessions ?? [];
  const sessionIdByPeriod = new Map(sessionRows.map((s) => [s.period_id as string, s.id as string]));

  const countsBySession = new Map<string, Record<string, number>>();
  const sessionIds = sessionRows.map((s) => s.id);
  if (sessionIds.length > 0) {
    const { data: records, error: recordsError } = await supabase
      .from("attendance_records")
      .select("session_id, status")
      .eq("institution_id", ctx.institution.id)
      .in("session_id", sessionIds);
    if (recordsError) throw recordsError;
    for (const r of records ?? []) {
      const counts = countsBySession.get(r.session_id) ?? {};
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      countsBySession.set(r.session_id, counts);
    }
  }

  return periodRows.map((p) => {
    const sessionId = sessionIdByPeriod.get(p.id) ?? null;
    return {
      periodId: p.id,
      seq: p.seq,
      name: p.name,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      sessionId,
      counts: sessionId ? countsBySession.get(sessionId) ?? {} : {},
    };
  });
}
