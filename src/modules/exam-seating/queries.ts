import "server-only";
// X06-T6 — examSeating.slots / .chart / .studentSeats reads. RLS (0088,
// T2) is the real visibility filter for guardian/student rows; the
// `institution_id` filters below are defense in depth, same shape as the
// rest of the exams module's queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { institutionTimeZone, localParts } from "@/modules/exams/schedule-conflicts";
import type { AdmitCard, ChartSeat, SeatingChart, SlotRow, StudentSeatRow } from "./schemas";

function sectionLabel(section: { name: string; grades: { code: string } | null } | null): string {
  return `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`;
}

function studentName(student: { first_name: string; last_name: string | null } | null): string {
  return [student?.first_name, student?.last_name].filter(Boolean).join(" ").trim();
}

/** Distinct `scheduled_at` of the exam's papers, ascending, with section coverage, current-plan status and staleness (rulings "Stale"). */
export async function listSeatingSlots(ctx: TenantContext, examId: string): Promise<SlotRow[]> {
  const supabase = await createClient();
  const { data: paperRows, error: paperError } = await supabase
    .from("exam_papers")
    .select("scheduled_at, class_section_id, class_sections(name, grades(code))")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .not("scheduled_at", "is", null);
  if (paperError) throw paperError;

  const slots = new Map<string, { sections: Map<string, string>; paperCount: number }>();
  for (const row of paperRows ?? []) {
    const slotStart = row.scheduled_at as string;
    const entry = slots.get(slotStart) ?? { sections: new Map<string, string>(), paperCount: 0 };
    entry.paperCount += 1;
    entry.sections.set(row.class_section_id, sectionLabel(row.class_sections as { name: string; grades: { code: string } | null } | null));
    slots.set(slotStart, entry);
  }

  const timeZone = institutionTimeZone(ctx.institution.settings);
  const now = Date.now();
  const result: SlotRow[] = [];

  for (const [slotStart, entry] of slots) {
    const sectionIds = [...entry.sections.keys()].sort();

    const { data: enrolRows, error: enrolError } = await supabase
      .from("enrolments")
      .select("student_id, students!inner(status)")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .eq("students.status", "active")
      .in("class_section_id", sectionIds);
    if (enrolError) throw enrolError;
    const studentCount = new Set((enrolRows ?? []).map((r) => r.student_id)).size;

    const { data: planRow, error: planError } = await supabase
      .from("exam_seating_plans")
      .select("id, version_no, seat_count, created_at, section_ids")
      .eq("institution_id", ctx.institution.id)
      .eq("exam_id", examId)
      .eq("slot_start", slotStart)
      .is("superseded_by", null)
      .maybeSingle();
    if (planError) throw planError;

    let plan: SlotRow["plan"] = null;
    if (planRow) {
      const planSectionIds = [...(planRow.section_ids as string[])].sort();
      const stale = JSON.stringify(planSectionIds) !== JSON.stringify(sectionIds) || planRow.seat_count !== studentCount;
      plan = {
        id: planRow.id,
        versionNo: planRow.version_no,
        seatCount: planRow.seat_count,
        generatedAt: planRow.created_at,
        stale,
      };
    }

    const { date, hhmm } = localParts(slotStart, timeZone);
    result.push({
      slotStart,
      localDate: date,
      localTime: hhmm,
      sections: sectionIds.map((id) => ({ id, label: entry.sections.get(id) as string })),
      paperCount: entry.paperCount,
      studentCount,
      started: new Date(slotStart).getTime() <= now,
      plan,
    });
  }

  return result.sort((a, b) => (a.slotStart < b.slotStart ? -1 : a.slotStart > b.slotStart ? 1 : 0));
}

/** Rooms with their seats in plan room order, seats by seat_no; RLS decides which seat rows a guardian/student sees. Null when the plan id doesn't resolve (not found, or RLS hides it). */
export async function getSeatingChart(ctx: TenantContext, planId: string): Promise<SeatingChart | null> {
  const supabase = await createClient();
  const { data: plan, error: planError } = await supabase
    .from("exam_seating_plans")
    .select("id, exam_name, slot_start, version_no, superseded_by, rooms")
    .eq("institution_id", ctx.institution.id)
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) return null;

  const { data: seatRows, error: seatError } = await supabase
    .from("exam_seats")
    .select("seat_no, student_id, class_section_id, room_id, students(first_name, last_name, admission_no), class_sections(name, grades(code))")
    .eq("institution_id", ctx.institution.id)
    .eq("plan_id", planId);
  if (seatError) throw seatError;

  const sectionIds = [...new Set((seatRows ?? []).map((r) => r.class_section_id))];
  const studentIds = [...new Set((seatRows ?? []).map((r) => r.student_id))];
  const rollNoByKey = new Map<string, number | null>();
  if (sectionIds.length > 0 && studentIds.length > 0) {
    const { data: enrolRows, error: enrolError } = await supabase
      .from("enrolments")
      .select("student_id, class_section_id, roll_no")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .in("class_section_id", sectionIds)
      .in("student_id", studentIds);
    if (enrolError) throw enrolError;
    for (const r of enrolRows ?? []) rollNoByKey.set(`${r.student_id}:${r.class_section_id}`, r.roll_no);
  }

  const seatsByRoom = new Map<string, ChartSeat[]>();
  for (const row of seatRows ?? []) {
    const student = row.students as { first_name: string; last_name: string | null; admission_no: string } | null;
    const list = seatsByRoom.get(row.room_id) ?? [];
    list.push({
      seatNo: row.seat_no,
      studentId: row.student_id,
      studentName: studentName(student),
      admissionNo: student?.admission_no ?? "",
      rollNo: rollNoByKey.get(`${row.student_id}:${row.class_section_id}`) ?? null,
      sectionLabel: sectionLabel(row.class_sections as { name: string; grades: { code: string } | null } | null),
    });
    seatsByRoom.set(row.room_id, list);
  }

  const roomOrder = ((plan.rooms as { room_id: string }[] | null) ?? []).map((r) => r.room_id);
  const roomNameById = new Map<string, string>();
  if (roomOrder.length > 0) {
    const { data: roomRows, error: roomError } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("institution_id", ctx.institution.id)
      .in("id", roomOrder);
    if (roomError) throw roomError;
    for (const r of roomRows ?? []) roomNameById.set(r.id, r.name);
  }

  const timeZone = institutionTimeZone(ctx.institution.settings);
  const { date, hhmm } = localParts(plan.slot_start as string, timeZone);

  return {
    planId: plan.id,
    institutionName: ctx.institution.name,
    examName: plan.exam_name,
    slotStart: plan.slot_start as string,
    localDate: date,
    localTime: hhmm,
    versionNo: plan.version_no,
    isCurrent: plan.superseded_by === null,
    rooms: roomOrder.map((roomId) => ({
      room: { id: roomId, name: roomNameById.get(roomId) ?? "" },
      seats: (seatsByRoom.get(roomId) ?? []).sort((a, b) => a.seatNo - b.seatNo),
    })),
  };
}

/** The student's seats across current plans only, slot_start within the last 24h or later, newest-first-ordered-ascending, capped at 100 (rulings). */
export async function listStudentSeats(ctx: TenantContext, studentId: string): Promise<StudentSeatRow[]> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("exam_seats")
    .select(
      "seat_no, room_id, rooms(id, name), students(first_name, last_name), exam_seating_plans!inner(id, exam_name, slot_start, superseded_by)",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .is("exam_seating_plans.superseded_by", null)
    .gt("exam_seating_plans.slot_start", cutoff);
  if (error) throw error;

  const timeZone = institutionTimeZone(ctx.institution.settings);
  const rows: StudentSeatRow[] = (data ?? []).map((row) => {
    const plan = row.exam_seating_plans as { id: string; exam_name: string; slot_start: string } | null;
    const room = row.rooms as { id: string; name: string } | null;
    const student = row.students as { first_name: string; last_name: string | null } | null;
    const slotStart = plan?.slot_start ?? "";
    const { date, hhmm } = localParts(slotStart, timeZone);
    return {
      planId: plan?.id ?? "",
      studentId,
      studentName: studentName(student),
      examName: plan?.exam_name ?? "",
      slotStart,
      localDate: date,
      localTime: hhmm,
      room: { id: room?.id ?? "", name: room?.name ?? "" },
      seatNo: row.seat_no,
    };
  });

  rows.sort((a, b) => (a.slotStart < b.slotStart ? -1 : a.slotStart > b.slotStart ? 1 : 0));
  return rows.slice(0, 100);
}

/**
 * The section's papers of the exam (`scheduled_at` set, time order), one
 * card per active student (roll_no then admission_no), seat from the
 * current plan of each slot or `null` ("To be announced", rulings "Admit
 * card"). Empty when RLS hides `exam_papers` (guardian/student — T8 defs
 * turn that into `null`) or there is no active student to show.
 */
export async function getAdmitCards(
  ctx: TenantContext,
  params: { examId: string; classSectionId: string; studentId?: string },
): Promise<AdmitCard[]> {
  const supabase = await createClient();

  const { data: paperRows, error: paperError } = await supabase
    .from("exam_papers")
    .select("scheduled_at, duration_minutes, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", params.examId)
    .eq("class_section_id", params.classSectionId)
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });
  if (paperError) throw paperError;
  if (!paperRows || paperRows.length === 0) return [];

  let studentQuery = supabase
    .from("enrolments")
    .select("student_id, roll_no, students!inner(first_name, last_name, admission_no, status)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", params.classSectionId)
    .eq("status", "active")
    .eq("students.status", "active");
  if (params.studentId) studentQuery = studentQuery.eq("student_id", params.studentId);
  const { data: studentRows, error: studentError } = await studentQuery;
  if (studentError) throw studentError;
  if (!studentRows || studentRows.length === 0) return [];

  const sortedStudents = [...studentRows].sort((a, b) => {
    if (a.roll_no !== null && b.roll_no !== null) return a.roll_no - b.roll_no;
    if (a.roll_no !== null) return -1;
    if (b.roll_no !== null) return 1;
    const aAdm = (a.students as { admission_no: string }).admission_no;
    const bAdm = (b.students as { admission_no: string }).admission_no;
    return aAdm < bAdm ? -1 : aAdm > bAdm ? 1 : 0;
  });

  const { data: sectionRow, error: sectionError } = await supabase
    .from("class_sections")
    .select("name, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .eq("id", params.classSectionId)
    .maybeSingle();
  if (sectionError) throw sectionError;
  const label = sectionLabel(sectionRow as { name: string; grades: { code: string } | null } | null);

  const { data: examRow, error: examError } = await supabase
    .from("exams")
    .select("name")
    .eq("institution_id", ctx.institution.id)
    .eq("id", params.examId)
    .maybeSingle();
  if (examError) throw examError;
  const examName = examRow?.name ?? "";

  const studentIds = sortedStudents.map((r) => r.student_id);
  const { data: seatRows, error: seatError } = await supabase
    .from("exam_seats")
    .select("student_id, seat_no, rooms(name), exam_seating_plans!inner(slot_start, superseded_by, exam_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_seating_plans.exam_id", params.examId)
    .is("exam_seating_plans.superseded_by", null)
    .in("student_id", studentIds);
  if (seatError) throw seatError;

  const seatByKey = new Map<string, { roomName: string; seatNo: number }>();
  for (const row of seatRows ?? []) {
    const plan = row.exam_seating_plans as { slot_start: string } | null;
    if (!plan) continue;
    const room = row.rooms as { name: string } | null;
    seatByKey.set(`${row.student_id}:${new Date(plan.slot_start).getTime()}`, {
      roomName: room?.name ?? "",
      seatNo: row.seat_no,
    });
  }

  const timeZone = institutionTimeZone(ctx.institution.settings);
  const papers = (paperRows ?? []).map((p) => {
    const scheduledAt = p.scheduled_at as string;
    const { date, hhmm: start } = localParts(scheduledAt, timeZone);
    const endIso = new Date(new Date(scheduledAt).getTime() + (p.duration_minutes ?? 0) * 60_000).toISOString();
    const { hhmm: end } = localParts(endIso, timeZone);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(scheduledAt));
    const subject = (p.subjects as { name: string } | null)?.name ?? "";
    return { subject, date, weekday, start, end, scheduledAt };
  });

  return sortedStudents.map((row) => {
    const student = row.students as { first_name: string; last_name: string | null; admission_no: string } | null;
    return {
      institutionName: ctx.institution.name,
      examName,
      studentName: studentName(student),
      admissionNo: student?.admission_no ?? "",
      rollNo: row.roll_no,
      sectionLabel: label,
      papers: papers.map((p) => {
        const seat = seatByKey.get(`${row.student_id}:${new Date(p.scheduledAt).getTime()}`);
        return {
          subject: p.subject,
          date: p.date,
          weekday: p.weekday,
          start: p.start,
          end: p.end,
          room: seat?.roomName ?? null,
          seatNo: seat?.seatNo ?? null,
        };
      }),
    };
  });
}

export interface RoomOption {
  id: string;
  name: string;
  capacity: number;
}

/** Rooms the seating generator may use (rooms_select: every member of the institution). */
export async function listRoomOptions(ctx: TenantContext): Promise<RoomOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").select("id, name, capacity").eq("institution_id", ctx.institution.id).order("name");
  if (error) throw error;
  return data ?? [];
}
