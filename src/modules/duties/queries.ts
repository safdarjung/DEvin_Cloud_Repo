import "server-only";
// Duty reads — the signed-in user's RLS client. Staff names come from the `duty_staff_options` definer
// (0132: id + name of active teaching staff, any duty.read role), then from `staff` under RLS for anyone
// else (0004 staff_select: managers only). Unresolved names are returned as null, never guessed.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "./dates";

const ROW_LIMIT = 5000;
const LOAD_DAYS = 60;

function check(error: unknown): void {
  if (!error) return;
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function eligibleStaff(ctx: TenantContext): Promise<{ staff_id: string; display_name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duty_staff_options", { p_institution_id: ctx.institution.id });
  check(error);
  return data ?? [];
}

async function staffNames(ctx: TenantContext, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  for (const s of await eligibleStaff(ctx)) out.set(s.staff_id, s.display_name);
  // Staff outside the eligible list (inactive, non-teaching): RLS decides, so only managers get these.
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff").select("id, full_name").eq("institution_id", ctx.institution.id).in("id", missing);
  check(error);
  for (const s of data ?? []) out.set(s.id, s.full_name);
  return out;
}

export interface DutyTypeRow {
  id: string;
  name: string;
  slotsPerDay: number;
  isActive: boolean;
}

export interface DutyAssignmentRow {
  id: string;
  date: string;
  status: string;
  dutyTypeId: string;
  staffId: string;
  staffName: string | null;
  isMine: boolean;
}

export interface DutySwapRow {
  id: string;
  status: string;
  assignmentId: string;
  date: string | null;
  dutyTypeName: string | null;
  fromStaffId: string;
  toStaffId: string;
  fromName: string | null;
  toName: string | null;
  isIncoming: boolean;
  isOutgoing: boolean;
  createdAt: string;
}

export async function dutyTypes(ctx: TenantContext): Promise<DutyTypeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("duty_types").select("id, name, slots_per_day, is_active").eq("institution_id", ctx.institution.id).order("name");
  check(error);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, slotsPerDay: r.slots_per_day, isActive: r.is_active }));
}

/** Non-cancelled assignments dated from..to (inclusive). */
export async function dutyRoster(ctx: TenantContext, from: string, to: string): Promise<DutyAssignmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duty_assignments")
    .select("id, date, status, duty_type_id, staff_id")
    .eq("institution_id", ctx.institution.id)
    .neq("status", "cancelled")
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .limit(ROW_LIMIT);
  check(error);
  const names = await staffNames(ctx, [...new Set((data ?? []).map((r) => r.staff_id))]);
  const me = ctx.membership.staffId;
  return (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    status: r.status,
    dutyTypeId: r.duty_type_id,
    staffId: r.staff_id,
    staffName: names.get(r.staff_id) ?? null,
    isMine: r.staff_id === me,
  }));
}

/** Swap requests the caller may see: managers all, teachers their own (RLS). Newest first. */
export async function dutySwaps(ctx: TenantContext): Promise<DutySwapRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duty_swap_requests")
    .select("id, status, assignment_id, from_staff_id, to_staff_id, created_at")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(100);
  check(error);
  const reqs = data ?? [];
  if (reqs.length === 0) return [];
  const { data: asg, error: aErr } = await supabase.from("duty_assignments").select("id, date, duty_type_id").in("id", [...new Set(reqs.map((r) => r.assignment_id))]);
  check(aErr);
  const types = new Map((await dutyTypes(ctx)).map((t) => [t.id, t.name]));
  const byId = new Map((asg ?? []).map((a) => [a.id, a]));
  const names = await staffNames(ctx, [...new Set(reqs.flatMap((r) => [r.from_staff_id, r.to_staff_id]))]);
  const me = ctx.membership.staffId;
  return reqs.map((r) => {
    const a = byId.get(r.assignment_id);
    return {
      id: r.id,
      status: r.status,
      assignmentId: r.assignment_id,
      date: a?.date ?? null,
      dutyTypeName: a ? (types.get(a.duty_type_id) ?? null) : null,
      fromStaffId: r.from_staff_id,
      toStaffId: r.to_staff_id,
      fromName: names.get(r.from_staff_id) ?? null,
      toName: names.get(r.to_staff_id) ?? null,
      isIncoming: r.to_staff_id === me,
      isOutgoing: r.from_staff_id === me,
      createdAt: r.created_at,
    };
  });
}

/** Active teaching staff of the institution (duty_staff_options, any duty.read role), excluding the caller. */
export async function dutyStaffOptions(ctx: TenantContext): Promise<{ id: string; label: string }[]> {
  return (await eligibleStaff(ctx)).filter((s) => s.staff_id !== ctx.membership.staffId).map((s) => ({ id: s.staff_id, label: s.display_name }));
}

/** Duties per staff over the last 60 days. Carries names: managers only. */
export async function dutyLoad(ctx: TenantContext, today: string): Promise<{ staffId: string; name: string | null; count: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duty_assignments")
    .select("staff_id")
    .eq("institution_id", ctx.institution.id)
    .neq("status", "cancelled")
    .gte("date", addDays(today, -LOAD_DAYS))
    .lte("date", today)
    .limit(ROW_LIMIT);
  check(error);
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.staff_id, (counts.get(r.staff_id) ?? 0) + 1);
  const names = await staffNames(ctx, [...counts.keys()]);
  return [...counts].map(([staffId, count]) => ({ staffId, name: names.get(staffId) ?? null, count })).sort((a, b) => b.count - a.count || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Name-free aggregate: non-cancelled duties per duty type name over from..to. */
export async function dutyCountByType(ctx: TenantContext, from: string, to: string): Promise<{ dutyType: string; count: number }[]> {
  const supabase = await createClient();
  const [types, { data, error }] = await Promise.all([
    dutyTypes(ctx),
    supabase.from("duty_assignments").select("duty_type_id").eq("institution_id", ctx.institution.id).neq("status", "cancelled").gte("date", from).lte("date", to).limit(ROW_LIMIT),
  ]);
  check(error);
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.duty_type_id, (counts.get(r.duty_type_id) ?? 0) + 1);
  return types.map((t) => ({ dutyType: t.name, count: counts.get(t.id) ?? 0 })).filter((r) => r.count > 0);
}
