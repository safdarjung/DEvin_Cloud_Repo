import "server-only";
// T-015 — attendance module reads (06 §W5). Always the signed-in user's RLS
// client (CLAUDE.md), with the same class-teacher narrowing as actions.ts
// for "which sections can I mark" (listing scope should match write scope).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

/** Institution-local calendar date (same approach as actions.ts's own `todayInTimezone` — not the server's UTC date). */
function todayInInstitutionTimezone(ctx: TenantContext): string {
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

/** Pure percentage math (AC5) — isolated so it can be unit-tested without a DB. */
export function computeAttendancePercentage(
  statusCodes: string[],
  statuses: Pick<AttendanceStatusOption, "code" | "countsPresent" | "inDenominator">[],
): { percentage: number; presentWeighted: number; totalInDenominator: number } {
  const byCode = new Map(statuses.map((s) => [s.code, s]));
  let presentWeighted = 0;
  let totalInDenominator = 0;

  for (const code of statusCodes) {
    const status = byCode.get(code);
    if (!status || !status.inDenominator) continue;
    totalInDenominator += 1;
    presentWeighted += status.countsPresent;
  }

  const percentage = totalInDenominator === 0 ? 0 : Math.round((presentWeighted / totalInDenominator) * 10000) / 100;
  return { percentage, presentWeighted, totalInDenominator };
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

  if (!term) {
    return {
      studentId,
      termId,
      percentage: 0,
      presentWeighted: 0,
      totalInDenominator: 0,
      thresholds: settings.thresholds,
    };
  }

  const { data: records, error: recordsError } = await supabase
    .from("attendance_records")
    .select("status, attendance_sessions!inner(date)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
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

// dashboard — T-039. Both queries below scope to today's date only, not the
// full attendance_records history (~181k rows): the row count is bounded to
// however many students were marked today, the same shape as
// getStudentAttendanceSummary's per-student fetch above, just institution-
// wide. They reuse computeAttendancePercentage rather than re-deriving the
// present/denominator weighting.

export interface AttendanceTodaySummary {
  date: string;
  percentage: number;
  presentWeighted: number;
  totalInDenominator: number;
}

/** Institution-wide attendance % for today, across all sections. */
export async function attendanceTodaySummary(ctx: TenantContext): Promise<AttendanceTodaySummary> {
  const supabase = await createClient();
  const settings = getAttendanceSettings(ctx);
  const date = todayInInstitutionTimezone(ctx);

  const { data, error } = await supabase
    .from("attendance_records")
    .select("status, attendance_sessions!inner(date)")
    .eq("institution_id", ctx.institution.id)
    .eq("attendance_sessions.date", date);
  if (error) throw error;

  const { percentage, presentWeighted, totalInDenominator } = computeAttendancePercentage(
    (data ?? []).map((r) => r.status),
    settings.statuses,
  );

  return { date, percentage, presentWeighted, totalInDenominator };
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

  const { data, error } = await supabase
    .from("attendance_records")
    .select("status, attendance_sessions!inner(date, class_sections(id, name, grades(code)))")
    .eq("institution_id", ctx.institution.id)
    .eq("attendance_sessions.date", date);
  if (error) throw error;

  const bySection = new Map<string, { label: string; codes: string[] }>();
  for (const row of data ?? []) {
    const session = row.attendance_sessions as unknown as {
      class_sections: { id: string; name: string; grades: { code: string } | null } | null;
    };
    const section = session.class_sections;
    if (!section) continue;
    const entry = bySection.get(section.id) ?? { label: `${section.grades?.code ?? "?"}-${section.name}`, codes: [] as string[] };
    entry.codes.push(row.status);
    bySection.set(section.id, entry);
  }

  return Array.from(bySection.entries())
    .map(([classSectionId, entry]) => ({
      classSectionId,
      label: entry.label,
      percentage: computeAttendancePercentage(entry.codes, settings.statuses).percentage,
    }))
    .filter((s) => s.percentage < settings.thresholds.critical)
    .sort((a, b) => a.percentage - b.percentage);
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
    const recentAbsentDayOffsets: number[] = [];

    for (const r of records) {
      const status = byCode.get(r.status);
      if (!status || !status.inDenominator) continue;
      const fullyPresent = status.countsPresent >= 1;
      const isLate = r.status.toLowerCase() === "late";

      if (fullyPresent) presentCount += 1;
      else if (isLate) lateCount += 1;
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
      recentAbsentDayOffsets: recentAbsentDayOffsets.sort((a, b) => a - b),
    };
  });

  return { classTeacherId: section.class_teacher_id, students };
}
