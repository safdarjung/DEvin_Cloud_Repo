import "server-only";
// T-015 — attendance module reads (06 §W5). Always the signed-in user's RLS
// client (CLAUDE.md), with the same class-teacher narrowing as actions.ts
// for "which sections can I mark" (listing scope should match write scope).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";

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
