import "server-only";
// Hostel reads — always the signed-in user's RLS client (owner/principal/admin only).
import { createClient } from "@/lib/supabase/server";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import type { HostelRollCallQueryInput } from "./schemas";

const STUDENT_LIMIT = 500;

function check(error: unknown): void {
  if (!error) return;
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function fullName(s: { first_name: string; last_name: string | null } | null): string {
  return s ? [s.first_name, s.last_name].filter(Boolean).join(" ") : "Unknown student";
}

export interface HostelRoomRow {
  id: string;
  block: string;
  roomNo: string;
  capacity: number;
  isActive: boolean;
  occupied: number;
}

/** Name-free aggregate: rooms with occupancy. */
export async function hostelRooms(ctx: TenantContext): Promise<HostelRoomRow[]> {
  const supabase = await createClient();
  const [rooms, active] = await Promise.all([
    supabase.from("hostel_rooms").select("id, block, room_no, capacity, is_active").eq("institution_id", ctx.institution.id).order("block").order("room_no"),
    supabase.from("hostel_allocations").select("room_id").eq("institution_id", ctx.institution.id).is("vacated_on", null),
  ]);
  check(rooms.error);
  check(active.error);
  const counts = new Map<string, number>();
  for (const a of active.data ?? []) counts.set(a.room_id, (counts.get(a.room_id) ?? 0) + 1);
  return (rooms.data ?? []).map((r) => ({
    id: r.id,
    block: r.block,
    roomNo: r.room_no,
    capacity: r.capacity,
    isActive: r.is_active,
    occupied: counts.get(r.id) ?? 0,
  }));
}

export interface HostelAllocationRow {
  id: string;
  roomId: string;
  room: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  allocatedOn: string;
}

/** Active allocations (vacated_on is null), with room label and student name. */
export async function hostelAllocations(ctx: TenantContext): Promise<HostelAllocationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostel_allocations")
    .select("id, room_id, student_id, allocated_on, hostel_rooms!hostel_allocations_room_fk(block, room_no), students(first_name, last_name, admission_no)")
    .eq("institution_id", ctx.institution.id)
    .is("vacated_on", null)
    .order("allocated_on", { ascending: false });
  check(error);
  return (data ?? []).map((a) => ({
    id: a.id,
    roomId: a.room_id,
    room: a.hostel_rooms ? `${a.hostel_rooms.block}-${a.hostel_rooms.room_no}` : "Unknown room",
    studentId: a.student_id,
    studentName: fullName(a.students),
    admissionNo: a.students?.admission_no ?? "",
    allocatedOn: a.allocated_on,
  }));
}

export interface HostelStudentOption {
  id: string;
  name: string;
  admissionNo: string;
}

/** Active students with no active allocation — the allocate picker. */
export async function hostelAllocatableStudents(ctx: TenantContext): Promise<HostelStudentOption[]> {
  const supabase = await createClient();
  const [students, active] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name, admission_no")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .order("first_name")
      .limit(STUDENT_LIMIT),
    supabase.from("hostel_allocations").select("student_id").eq("institution_id", ctx.institution.id).is("vacated_on", null),
  ]);
  check(students.error);
  check(active.error);
  const taken = new Set((active.data ?? []).map((a) => a.student_id));
  return (students.data ?? []).filter((s) => !taken.has(s.id)).map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admission_no }));
}

export interface HostelRollCallEntryRow {
  studentId: string;
  status: "present" | "absent" | "on_leave";
  note: string | null;
}

export interface HostelRollCallRow {
  id: string;
  takenOn: string;
  session: string;
  entries: HostelRollCallEntryRow[];
}

/** The roll call for one date + session, or null when none was taken yet. */
export async function hostelRollCall(ctx: TenantContext, input: HostelRollCallQueryInput): Promise<HostelRollCallRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hostel_roll_calls")
    .select("id, taken_on, session, hostel_roll_call_entries(student_id, status, note)")
    .eq("institution_id", ctx.institution.id)
    .eq("taken_on", input.takenOn)
    .eq("session", input.session)
    .maybeSingle();
  check(error);
  if (!data) return null;
  return {
    id: data.id,
    takenOn: data.taken_on,
    session: data.session,
    entries: data.hostel_roll_call_entries.map((e) => ({ studentId: e.student_id, status: e.status as HostelRollCallEntryRow["status"], note: e.note })),
  };
}
