import "server-only";
// X08-T6 — ptm.events / ptm.teacherSchedule / ptm.forStudent reads. RLS
// (0099) already narrows ptm_events/ptm_event_sections/ptm_slots/
// ptm_bookings to staff of the institution (and, for bookings, to the
// caller's own slots/children); the institution_id filters below are
// defense in depth, same shape as every other queries.ts. ptm.forStudent
// goes through the ptm_slots_for_student definer (guardian-of-student
// check + mine/taken/open state) rather than reading the tables directly —
// guardians have no SELECT policy on them (rulings §RLS).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission } from "@/lib/auth/require";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { toHHMM } from "@/modules/timetable/queries";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Slot k's start/end are derived (day_starts_at + k*slot_minutes), never stored — same formula as app.guard_ptm_slots_write / app.ptm_slots_for_student (0099). */
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface PtmEventRow {
  id: string;
  title: string;
  eventDate: string;
  dayStartsAt: string;
  dayEndsAt: string;
  slotMinutes: number;
  bookingClosesAt: string;
  status: string;
  classSectionIds: string[];
}

/** RLS-visible PTM events (staff roles only). Default: event_date >= today (IST); `includePast` drops that filter. Ordered by date. */
export async function ptmEvents(ctx: TenantContext, includePast?: boolean): Promise<PtmEventRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ptm_events")
    .select(
      "id, title, event_date, day_starts_at, day_ends_at, slot_minutes, booking_closes_at, status, ptm_event_sections(class_section_id)",
    )
    .eq("institution_id", ctx.institution.id)
    .order("event_date", { ascending: true });
  if (!includePast) {
    query = query.gte("event_date", todayInInstitutionTimezone(ctx));
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    dayStartsAt: toHHMM(row.day_starts_at),
    dayEndsAt: toHHMM(row.day_ends_at),
    slotMinutes: row.slot_minutes,
    bookingClosesAt: row.booking_closes_at,
    status: row.status,
    classSectionIds: ((row.ptm_event_sections as { class_section_id: string }[] | null) ?? []).map(
      (s) => s.class_section_id,
    ),
  }));
}

export interface PtmScheduleRow {
  slotId: string;
  seq: number;
  startsAt: string;
  endsAt: string;
  booking: { bookingId: string; studentId: string; studentName: string; sectionName: string } | null;
}

interface SlotBookingEmbed {
  id: string;
  student_id: string;
  status: string;
  students: {
    first_name: string;
    last_name: string | null;
    enrolments: { status: string; class_sections: { name: string; grades: { display_name: string } | null } | null }[] | null;
  } | null;
}

/** One teacher's slot grid for an event, with the booked child (if any). staffId defaults to the caller's own; another staffId needs ptm.manage. Booked bookings only (cancelled rows are dropped). */
export async function ptmTeacherSchedule(
  ctx: TenantContext,
  eventId: string,
  staffId?: string,
): Promise<PtmScheduleRow[]> {
  const targetStaffId = staffId ?? ctx.membership.staffId ?? null;
  if (!targetStaffId) {
    throw new AppError("validation_failed", "staffId is required.", { staffId: ["staffId is required."] });
  }
  if (staffId && staffId !== ctx.membership.staffId && !hasPermission(ctx, "ptm.manage")) {
    throw new AppError("forbidden", "You do not have permission to view another teacher's schedule.");
  }

  const supabase = await createClient();
  const { data: event, error: eventError } = await supabase
    .from("ptm_events")
    .select("day_starts_at, slot_minutes")
    .eq("id", eventId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return [];
  const dayStartsAt = toHHMM(event.day_starts_at);

  const { data: slots, error: slotsError } = await supabase
    .from("ptm_slots")
    .select(
      "id, seq, ptm_bookings(id, student_id, status, students(first_name, last_name, enrolments(status, class_sections(name, grades(display_name)))))",
    )
    .eq("event_id", eventId)
    .eq("staff_id", targetStaffId)
    .order("seq", { ascending: true });
  if (slotsError) throw slotsError;

  return (slots ?? []).map((row) => {
    const bookings = (row.ptm_bookings as SlotBookingEmbed[] | null) ?? [];
    const booked = bookings.find((b) => b.status === "booked") ?? null;
    let booking: PtmScheduleRow["booking"] = null;
    if (booked) {
      const student = booked.students;
      const activeSection = (student?.enrolments ?? []).find((e) => e.status === "active")?.class_sections ?? null;
      booking = {
        bookingId: booked.id,
        studentId: booked.student_id,
        studentName: student ? [student.first_name, student.last_name].filter(Boolean).join(" ") : "",
        sectionName: activeSection ? `${activeSection.grades?.display_name ?? "?"}-${activeSection.name}` : "",
      };
    }
    return {
      slotId: row.id,
      seq: row.seq,
      startsAt: addMinutes(dayStartsAt, row.seq * event.slot_minutes),
      endsAt: addMinutes(dayStartsAt, (row.seq + 1) * event.slot_minutes),
      booking,
    };
  });
}

export interface PtmBookableRow {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  bookingClosesAt: string;
  staffId: string;
  teacherName: string;
  subjects: string[];
  isClassTeacher: boolean;
  slotId: string;
  seq: number;
  startsAt: string;
  endsAt: string;
  state: "mine" | "taken" | "open";
  bookingId: string | null;
}

/** A guardian's bookable PTM slots for one child, via the ptm_slots_for_student definer (guardian check + mine/taken/open state happen in SQL). */
export async function ptmForStudent(ctx: TenantContext, studentId: string, eventId?: string): Promise<PtmBookableRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ptm_slots_for_student", {
    p_student_id: studentId,
    ...(eventId ? { p_event_id: eventId } : {}),
  });
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventDate: row.event_date,
    bookingClosesAt: row.booking_closes_at,
    staffId: row.staff_id,
    teacherName: row.teacher_name,
    subjects: row.subjects ?? [],
    isClassTeacher: row.is_class_teacher,
    slotId: row.slot_id,
    seq: row.seq,
    startsAt: toHHMM(row.starts_at),
    endsAt: toHHMM(row.ends_at),
    state: row.state as "mine" | "taken" | "open",
    bookingId: row.booking_id,
  }));
}
