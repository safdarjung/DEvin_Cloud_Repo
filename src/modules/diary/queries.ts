import "server-only";
// X01-T9 — diary.* reads: diary_entries/diary_acknowledgements owned by this
// module (0085 part 2). RLS already narrows visibility (admin trio; taught
// sections for teachers; own section for guardian/student) — the
// institution_id/class_section_id filters below are defense in depth, same
// shape as every other queries.ts (mirrors src/modules/timetable/queries.ts's
// forStudent enrolment resolution + src/modules/attendance/queries.ts's
// todayInInstitutionTimezone for the default window).
import { AppError } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";

const DEFAULT_WINDOW_BACK_DAYS = 6;
const DEFAULT_WINDOW_FORWARD_DAYS = 7;

/** `dateIso` + `days` (UTC calendar arithmetic, no tz shift) — mirrors timetable/queries.ts's addDaysIso, negative `days` included. */
function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Rulings: default window today-6 .. today+7 in institution tz; either bound given overrides just that side. */
function resolveWindow(ctx: TenantContext, from?: string, to?: string): { from: string; to: string } {
  const today = todayInInstitutionTimezone(ctx);
  return {
    from: from ?? addDaysIso(today, -DEFAULT_WINDOW_BACK_DAYS),
    to: to ?? addDaysIso(today, DEFAULT_WINDOW_FORWARD_DAYS),
  };
}

export interface DiaryEntryRow {
  id: string;
  entryDate: string;
  subject: { id: string; name: string } | null;
  body: string;
  dueDate: string | null;
  requiresAck: boolean;
  /** null unless the caller holds `diary.write` (rulings). */
  ackCount: number | null;
}

export interface DiaryEntryForStudentRow extends DiaryEntryRow {
  acknowledged: boolean;
}

export interface DiaryAckStatusRow {
  studentId: string;
  name: string;
  rollNo: number | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

/** entry_id -> ack count, for the given entries only (one batched query). */
async function ackCountsByEntry(ctx: TenantContext, entryIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (entryIds.length === 0) return counts;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("diary_acknowledgements")
    .select("entry_id")
    .eq("institution_id", ctx.institution.id)
    .in("entry_id", entryIds);
  if (error) throw error;
  for (const row of data ?? []) counts.set(row.entry_id, (counts.get(row.entry_id) ?? 0) + 1);
  return counts;
}

/** entry_id set this student has acknowledged, among the given entries only. */
async function ackedEntryIds(ctx: TenantContext, studentId: string, entryIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (entryIds.length === 0) return ids;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("diary_acknowledgements")
    .select("entry_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .in("entry_id", entryIds);
  if (error) throw error;
  for (const row of data ?? []) ids.add(row.entry_id);
  return ids;
}

/** The section's diary entries in the window, newest entry_date first then created_at. RLS narrows to admin/taught-section/own-section. */
export async function diaryForSection(
  ctx: TenantContext,
  classSectionId: string,
  from?: string,
  to?: string,
): Promise<DiaryEntryRow[]> {
  const window = resolveWindow(ctx, from, to);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("diary_entries")
    .select("id, entry_date, due_date, body, requires_ack, subjects(id, name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .gte("entry_date", window.from)
    .lte("entry_date", window.to)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const counts = hasPermission(ctx, "diary.write") ? await ackCountsByEntry(ctx, rows.map((row) => row.id)) : null;

  return rows.map((row) => {
    const subject = row.subjects as { id: string; name: string } | null;
    return {
      id: row.id,
      entryDate: row.entry_date,
      subject: subject ? { id: subject.id, name: subject.name } : null,
      body: row.body,
      dueDate: row.due_date,
      requiresAck: row.requires_ack,
      ackCount: counts ? counts.get(row.id) ?? 0 : null,
    };
  });
}

/** The student's own active enrolment section's entries, with `acknowledged` for that student. RLS hides the enrolment row for a family that doesn't own this student, so this resolves to [] rather than leaking. */
export async function diaryForStudent(
  ctx: TenantContext,
  studentId: string,
  from?: string,
  to?: string,
): Promise<DiaryEntryForStudentRow[]> {
  const supabase = await createClient();
  const { data: enrolment, error } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!enrolment) return [];

  const entries = await diaryForSection(ctx, enrolment.class_section_id, from, to);
  if (entries.length === 0) return [];

  const acked = await ackedEntryIds(ctx, studentId, entries.map((entry) => entry.id));
  return entries.map((entry) => ({ ...entry, acknowledged: acked.has(entry.id) }));
}

/** The actively enrolled students of the entry's section, by roll number, with that student's ack. Entry invisible under RLS -> not_found (rulings). */
export async function diaryAckStatus(ctx: TenantContext, entryId: string): Promise<DiaryAckStatusRow[]> {
  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from("diary_entries")
    .select("id, class_section_id")
    .eq("id", entryId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!entry) throw new AppError("not_found", "Diary entry not found.");

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, roll_no, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", entry.class_section_id)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false });
  if (enrolError) throw enrolError;

  const { data: acks, error: acksError } = await supabase
    .from("diary_acknowledgements")
    .select("student_id, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("entry_id", entryId);
  if (acksError) throw acksError;
  const ackByStudent = new Map((acks ?? []).map((ack) => [ack.student_id, ack.created_at]));

  return (enrolments ?? []).map((e) => {
    const student = e.students as { first_name: string; last_name: string | null } | null;
    return {
      studentId: e.student_id,
      name: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      rollNo: e.roll_no,
      acknowledged: ackByStudent.has(e.student_id),
      acknowledgedAt: ackByStudent.get(e.student_id) ?? null,
    };
  });
}
