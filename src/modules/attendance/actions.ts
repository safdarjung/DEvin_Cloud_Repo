"use server";

// T-015 — attendance module actions (06 §W5, 07 §2.2 attendance.mark/
// .correct). `submitAttendance`/`correctAttendance` are thin wrappers over
// the security-definer RPCs in 20261028000014_attendance_submit.sql, which
// are themselves the authorization/audit boundary (lead ruling: callable
// directly via PostgREST). `markAttendance` stays a direct RLS
// upsert (lead ruling item 4) — RLS (0006/0014) already scopes it to the
// class teacher or owner/principal/admin; this handler additionally narrows
// to the section's OWN class teacher (packet: "RLS allows subject teachers,
// the action does not" — app.teaches_section is broader than this).
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import {
  CorrectAttendanceSchema,
  MarkAttendanceSchema,
  MarkPeriodAttendanceSchema,
  SubmitAttendanceSchema,
  type CorrectAttendanceInput,
  type MarkAttendanceInput,
  type MarkPeriodAttendanceInput,
  type SubmitAttendanceInput,
} from "./schemas";

type AttendanceClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Configured attendance status codes (05 §4.1) for this institution, or `[]` if settings don't parse. */
function attendanceStatusCodes(ctx: TenantContext): Set<string> {
  const parsed = InstitutionSettingsSchema.shape.attendance.safeParse(ctx.institution.settings.attendance);
  if (!parsed.success) return new Set();
  return new Set(parsed.data.statuses.map((s) => s.code));
}

/** `new Intl.DateTimeFormat` with `timeZone` gives the institution-local calendar date, not the server's. */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function daysBetween(laterIso: string, earlierIso: string): number {
  const msPerDay = 86_400_000;
  return Math.round((new Date(`${laterIso}T00:00:00Z`).getTime() - new Date(`${earlierIso}T00:00:00Z`).getTime()) / msPerDay);
}

interface SectionRow {
  id: string;
  class_teacher_id: string | null;
}

async function loadSection(supabase: AttendanceClient, institutionId: string, classSectionId: string): Promise<SectionRow> {
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, class_teacher_id")
    .eq("id", classSectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Class section not found.");
  return data;
}

/** Packet: marking is narrowed to the section's own class teacher, not every `app.teaches_section` match. */
function isClassTeacherOrAdmin(ctx: TenantContext, classTeacherId: string | null): boolean {
  if (ctx.membership.role === "owner" || ctx.membership.role === "principal" || ctx.membership.role === "admin") {
    return true;
  }
  return Boolean(ctx.membership.staffId && classTeacherId === ctx.membership.staffId);
}

export const markAttendance = defineAction({
  name: "attendance.mark",
  module: "attendance",
  schema: MarkAttendanceSchema,
  permission: "attendance.mark",
  handler: async (input: MarkAttendanceInput, ctx) => {
    const supabase = await createClient();
    const section = await loadSection(supabase, ctx.institution.id, input.classSectionId);

    if (!isClassTeacherOrAdmin(ctx, section.class_teacher_id)) {
      throw new AppError("forbidden", "You are not the class teacher of this section.");
    }

    const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
    const today = todayInTimezone(locale.success ? locale.data.timezone : "Asia/Kolkata");
    if (input.date > today) {
      throw new AppError("validation_failed", "Attendance date cannot be in the future.", { date: ["Cannot be in the future."] });
    }
    if (daysBetween(today, input.date) > 7 && !ctx.permissions.has("attendance.correct")) {
      throw new AppError("forbidden", "Marking attendance more than 7 days back requires attendance.correct.");
    }

    const validCodes = attendanceStatusCodes(ctx);
    const badStatus = input.records.find((r) => !validCodes.has(r.status));
    if (badStatus) {
      throw new AppError("validation_failed", `"${badStatus.status}" is not a configured attendance status.`, {
        status: [`"${badStatus.status}" is not a configured attendance status.`],
      });
    }

    const { data: enrolled, error: enrolError } = await supabase
      .from("enrolments")
      .select("student_id")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", input.classSectionId)
      .eq("status", "active");
    if (enrolError) throwMapped(enrolError);
    const enrolledIds = new Set((enrolled ?? []).map((e) => e.student_id));
    const notEnrolled = input.records.find((r) => !enrolledIds.has(r.studentId));
    if (notEnrolled) {
      throw new AppError("validation_failed", "One or more students are not actively enrolled in this section.");
    }

    const { data: existingSession, error: sessionReadError } = await supabase
      .from("attendance_sessions")
      .select("id, status")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", input.classSectionId)
      .eq("date", input.date)
      .is("period_id", null)
      .maybeSingle();
    if (sessionReadError) throwMapped(sessionReadError);
    if (existingSession?.status === "submitted") {
      throw new AppError("invalid_state", "This session is already submitted; use a correction instead.");
    }

    const { data: session, error: sessionError } = await supabase
      .from("attendance_sessions")
      .upsert(
        {
          institution_id: ctx.institution.id,
          class_section_id: input.classSectionId,
          date: input.date,
          status: "open",
          marked_by: ctx.membership.staffId,
        },
        { onConflict: "class_section_id,date,period_id" },
      )
      .select("id")
      .single();
    if (sessionError) throwMapped(sessionError);

    const { error: recordsError } = await supabase.from("attendance_records").upsert(
      input.records.map((r) => ({
        institution_id: ctx.institution.id,
        session_id: session.id,
        student_id: r.studentId,
        status: r.status,
        note: r.note ?? null,
      })),
      { onConflict: "session_id,student_id" },
    );
    if (recordsError) throwMapped(recordsError);

    revalidatePath(`/${ctx.institution.slug}/attendance/${input.classSectionId}`);
    return { sessionId: session.id as string, recordCount: input.records.length };
  },
});

export const submitAttendance = defineAction({
  name: "attendance.submit",
  module: "attendance",
  schema: SubmitAttendanceSchema,
  permission: "attendance.mark",
  handler: async (input: SubmitAttendanceInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_attendance", {
      p_institution_id: ctx.institution.id,
      p_session_id: input.sessionId,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/attendance`);
    return { sessionId: data.id as string, status: data.status as string };
  },
});

// M08-T10 — period attendance (06 §W5 extension, 07 §4 definer row
// `mark_period_attendance`). The RPC (20261028000070_staffing.sql) is the
// authorization/state-machine boundary (slot teacher/substitute/admin,
// published-slot lookup, 7-day window, already-marked check) — same split
// as submitAttendance/correctAttendance above. This handler's only own job
// is the status-code check against `settings.attendance.statuses`, same
// rule as markAttendance, since the RPC does not parse per-institution
// config.
export const markPeriodAttendance = defineAction({
  name: "attendance.markPeriod",
  module: "timetable",
  schema: MarkPeriodAttendanceSchema,
  permission: "attendance.mark",
  handler: async (input: MarkPeriodAttendanceInput, ctx) => {
    const supabase = await createClient();

    const validCodes = attendanceStatusCodes(ctx);
    const badStatus = input.records.find((r) => !validCodes.has(r.status));
    if (badStatus) {
      throw new AppError("validation_failed", `"${badStatus.status}" is not a configured attendance status.`, {
        status: [`"${badStatus.status}" is not a configured attendance status.`],
      });
    }

    const { data, error } = await supabase.rpc("mark_period_attendance", {
      p_institution_id: ctx.institution.id,
      p_class_section_id: input.classSectionId,
      p_period_id: input.periodId,
      p_date: input.date,
      p_records: input.records.map((r) => ({ student_id: r.studentId, status: r.status, note: r.note ?? null })),
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/attendance/${input.classSectionId}`);
    return { sessionId: data.id as string, recordCount: input.records.length };
  },
});

export const correctAttendance = defineAction({
  name: "attendance.correct",
  module: "attendance",
  schema: CorrectAttendanceSchema,
  permission: "attendance.correct",
  handler: async (input: CorrectAttendanceInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("correct_attendance", {
      p_institution_id: ctx.institution.id,
      p_record_id: input.recordId,
      p_new_status: input.newStatus,
      p_reason: input.reason,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/attendance`);
    return { recordId: data.id as string, status: data.status as string };
  },
});
