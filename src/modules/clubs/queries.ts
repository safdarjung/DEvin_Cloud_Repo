import "server-only";
// Features-18 #6 — clubs & houses reads. RLS decides what each role sees:
// staff read every row; guardian/student read only their own children's
// membership/sign-up/house rows (member counts and house totals are NOT
// readable by them — 0115 has no aggregate definer; see report gap).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

/** Wall clock for server pages (kept out of components: react-hooks/purity). */
export const currentTimeMs = () => Date.now();

const MAX_ROWS = 2000; // shortcut: one page of rows, paginate when a school outgrows it.

export interface ClubRow {
  id: string;
  name: string;
  description: string | null;
  patronStaffId: string | null;
  patronName: string | null;
  capacity: number | null;
  isActive: boolean;
}

export interface ClubEventRow {
  id: string;
  clubId: string;
  clubName: string;
  title: string;
  description: string | null;
  venue: string | null;
  startsAt: string;
  endsAt: string | null;
  signupClosesAt: string | null;
  capacity: number | null;
  status: string;
}

export interface PersonRef {
  studentId: string;
  name: string;
  admissionNo: string;
}

type StudentEmbed = { first_name: string; last_name: string | null; admission_no: string } | null;

function toPerson(studentId: string, s: StudentEmbed): PersonRef {
  return {
    studentId,
    name: s ? [s.first_name, s.last_name].filter(Boolean).join(" ") : "Student",
    admissionNo: s?.admission_no ?? "",
  };
}

export async function clubsList(ctx: TenantContext): Promise<ClubRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clubs")
    .select("id, name, description, patron_staff_id, capacity, is_active, staff(full_name)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    patronStaffId: c.patron_staff_id,
    patronName: (c.staff as { full_name: string } | null)?.full_name ?? null,
    capacity: c.capacity,
    isActive: c.is_active,
  }));
}

export async function clubEventsList(ctx: TenantContext): Promise<ClubEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("club_events")
    .select("id, club_id, title, description, venue, starts_at, ends_at, signup_closes_at, capacity, status, clubs(name)")
    .eq("institution_id", ctx.institution.id)
    .order("starts_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    clubId: e.club_id,
    clubName: (e.clubs as { name: string } | null)?.name ?? "",
    title: e.title,
    description: e.description,
    venue: e.venue,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    signupClosesAt: e.signup_closes_at,
    capacity: e.capacity,
    status: e.status,
  }));
}

/** Staff only in practice: for a guardian/student RLS returns just their own rows. */
export async function clubMembersList(ctx: TenantContext, clubId?: string): Promise<(PersonRef & { clubId: string })[]> {
  const supabase = await createClient();
  let q = supabase
    .from("club_members")
    .select("club_id, student_id, students(first_name, last_name, admission_no)")
    .eq("institution_id", ctx.institution.id)
    .limit(MAX_ROWS);
  if (clubId) q = q.eq("club_id", clubId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((m) => ({ clubId: m.club_id, ...toPerson(m.student_id, m.students as StudentEmbed) }));
}

export async function eventSignupsList(ctx: TenantContext): Promise<(PersonRef & { eventId: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("club_event_signups")
    .select("event_id, student_id, students(first_name, last_name, admission_no)")
    .eq("institution_id", ctx.institution.id)
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []).map((s) => ({ eventId: s.event_id, ...toPerson(s.student_id, s.students as StudentEmbed) }));
}

export interface HouseRow {
  id: string;
  name: string;
  colour: string | null;
  points: number;
  members: PersonRef[];
}

/** Houses with member lists and point totals, highest points first. Totals/members are staff-visible only (RLS). */
export async function housesLeaderboard(ctx: TenantContext): Promise<HouseRow[]> {
  const supabase = await createClient();
  const [houses, members, points] = await Promise.all([
    supabase.from("houses").select("id, name, colour").eq("institution_id", ctx.institution.id),
    supabase
      .from("house_members")
      .select("house_id, student_id, students(first_name, last_name, admission_no)")
      .eq("institution_id", ctx.institution.id)
      .limit(MAX_ROWS),
    supabase.from("house_points").select("house_id, points").eq("institution_id", ctx.institution.id).limit(MAX_ROWS * 5),
  ]);
  for (const r of [houses, members, points]) if (r.error) throw r.error;

  const totals = new Map<string, number>();
  for (const p of points.data ?? []) totals.set(p.house_id, (totals.get(p.house_id) ?? 0) + p.points);
  return (houses.data ?? [])
    .map((h) => ({
      id: h.id,
      name: h.name,
      colour: h.colour,
      points: totals.get(h.id) ?? 0,
      members: (members.data ?? [])
        .filter((m) => m.house_id === h.id)
        .map((m) => toPerson(m.student_id, m.students as StudentEmbed)),
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

export async function recentHousePoints(ctx: TenantContext, limit = 15) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_points")
    .select("id, points, reason, created_at, houses(name), students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    points: p.points,
    reason: p.reason,
    createdAt: p.created_at,
    houseName: (p.houses as { name: string } | null)?.name ?? "",
    studentName: p.students ? [(p.students as { first_name: string }).first_name, (p.students as { last_name: string | null }).last_name].filter(Boolean).join(" ") : null,
  }));
}

export async function activeStudentOptions(ctx: TenantContext): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, first_name, last_name, admission_no")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("first_name")
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, label: `${[s.first_name, s.last_name].filter(Boolean).join(" ")} (${s.admission_no})` }));
}

export async function staffOptions(ctx: TenantContext): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("full_name")
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, label: s.full_name }));
}

export interface MyClubState {
  clubIds: string[];
  signedUpEventIds: string[];
  house: { name: string; colour: string | null } | null;
}

/** The one student's own rows (RLS lets guardian/student read exactly these). */
export async function myClubState(ctx: TenantContext, studentId: string): Promise<MyClubState> {
  const supabase = await createClient();
  const [members, signups, house] = await Promise.all([
    supabase.from("club_members").select("club_id").eq("student_id", studentId),
    supabase.from("club_event_signups").select("event_id").eq("student_id", studentId),
    supabase
      .from("house_members")
      .select("houses(name, colour)")
      .eq("student_id", studentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle(),
  ]);
  for (const r of [members, signups, house]) if (r.error) throw r.error;
  return {
    clubIds: (members.data ?? []).map((m) => m.club_id),
    signedUpEventIds: (signups.data ?? []).map((s) => s.event_id),
    house: (house.data?.houses as { name: string; colour: string | null } | null) ?? null,
  };
}
