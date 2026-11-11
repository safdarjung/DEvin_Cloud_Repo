import "server-only";
// School labs reads — always the signed-in user's RLS client (lab.read: owner/principal/admin/teacher).
import { createClient } from "@/lib/supabase/server";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { labSafetyWarnings, type SafetyWarning } from "./safety";
import type { UtilisationQueryInput } from "./schemas";

const LIMIT = 500;
const BOOKING_WINDOW_PAST_DAYS = 30;
const BOOKING_WINDOW_FUTURE_DAYS = 30;

function check(error: unknown): void {
  if (!error) return;
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** `iso` + `days` (UTC calendar arithmetic, no tz shift). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week containing `iso`. */
export function weekStartOf(iso: string): string {
  const dow = new Date(Date.parse(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export interface LabRow {
  id: string;
  name: string;
  kind: string;
  capacity: number;
  isActive: boolean;
}

export async function schoolLabs(ctx: TenantContext): Promise<LabRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("school_labs").select("id, name, kind, capacity, is_active").eq("institution_id", ctx.institution.id).order("name");
  check(error);
  return (data ?? []).map((l) => ({ id: l.id, name: l.name, kind: l.kind, capacity: l.capacity, isActive: l.is_active }));
}

export interface EquipmentRow {
  id: string;
  labId: string;
  name: string;
  kind: string;
  quantity: number;
  unit: string;
  hazardClass: string | null;
  expiryOn: string | null;
  condition: string;
}

export async function schoolLabEquipment(ctx: TenantContext, labId?: string): Promise<EquipmentRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("school_lab_equipment")
    .select("id, lab_id, name, kind, quantity, unit, hazard_class, expiry_on, condition")
    .eq("institution_id", ctx.institution.id)
    .order("name")
    .limit(LIMIT);
  if (labId) q = q.eq("lab_id", labId);
  const { data, error } = await q;
  check(error);
  return (data ?? []).map((e) => ({
    id: e.id,
    labId: e.lab_id,
    name: e.name,
    kind: e.kind,
    quantity: Number(e.quantity),
    unit: e.unit,
    hazardClass: e.hazard_class,
    expiryOn: e.expiry_on,
    condition: e.condition,
  }));
}

export interface PeriodRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

/** Teaching periods (breaks excluded) in bell order. */
export async function schoolLabPeriods(ctx: TenantContext): Promise<PeriodRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("periods").select("id, name, starts_at, ends_at").eq("institution_id", ctx.institution.id).eq("is_break", false).order("seq");
  check(error);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, startsAt: p.starts_at.slice(0, 5), endsAt: p.ends_at.slice(0, 5) }));
}

export interface BookingRow {
  id: string;
  labId: string;
  date: string;
  periodId: string;
  staffId: string;
  teacher: string;
  section: string;
  subject: string;
  purpose: string | null;
}

/** Booked (not cancelled) rows of one lab for the Mon-Sat week starting `weekStart`. */
export async function schoolLabWeek(ctx: TenantContext, labId: string, weekStart: string): Promise<BookingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_lab_bookings")
    .select("id, lab_id, date, period_id, staff_id, purpose, staff(full_name), subjects(name), class_sections(name, grades(display_name))")
    .eq("institution_id", ctx.institution.id)
    .eq("lab_id", labId)
    .eq("status", "booked")
    .gte("date", weekStart)
    .lte("date", addDays(weekStart, 5));
  check(error);
  return (data ?? []).map((b) => toBookingRow(b));
}

function toBookingRow(b: {
  id: string;
  lab_id: string;
  date: string;
  period_id: string;
  staff_id: string;
  purpose: string | null;
  staff: { full_name: string } | null;
  subjects: { name: string } | null;
  class_sections: { name: string; grades: { display_name: string } | null } | null;
}): BookingRow {
  const cs = b.class_sections;
  return {
    id: b.id,
    labId: b.lab_id,
    date: b.date,
    periodId: b.period_id,
    staffId: b.staff_id,
    teacher: b.staff?.full_name ?? "Teacher",
    section: cs ? `${cs.grades?.display_name ?? ""} ${cs.name}`.trim() : "Section",
    subject: b.subjects?.name ?? "Subject",
    purpose: b.purpose,
  };
}

export interface BookingOption {
  id: string;
  labId: string;
  label: string;
}

/** Booked rows around today for the experiment/incident pickers. Teachers see only their own (also enforced by RLS on writes). */
export async function schoolLabBookingOptions(ctx: TenantContext): Promise<BookingOption[]> {
  const supabase = await createClient();
  const today = todayInInstitutionTimezone(ctx);
  let q = supabase
    .from("school_lab_bookings")
    .select("id, lab_id, date, period_id, staff_id, purpose, staff(full_name), subjects(name), class_sections(name, grades(display_name)), school_labs!school_lab_bookings_lab_fk(name), periods(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "booked")
    .gte("date", addDays(today, -BOOKING_WINDOW_PAST_DAYS))
    .lte("date", addDays(today, BOOKING_WINDOW_FUTURE_DAYS))
    .order("date", { ascending: false })
    .limit(LIMIT);
  if (!ctx.permissions.has("lab.manage")) q = q.eq("staff_id", ctx.membership.staffId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  check(error);
  return (data ?? []).map((b) => {
    const r = toBookingRow(b);
    return { id: b.id, labId: b.lab_id, label: `${b.school_labs?.name ?? "Lab"} · ${b.date} · ${b.periods?.name ?? "Period"} · ${r.section} ${r.subject}` };
  });
}

export interface PickerOptions {
  sections: { id: string; label: string }[];
  subjects: { id: string; label: string }[];
  /** Active staff, for managers booking on a teacher's behalf. */
  staff: { id: string; label: string }[];
}

export async function schoolLabPickerOptions(ctx: TenantContext): Promise<PickerOptions> {
  const supabase = await createClient();
  const manager = ctx.permissions.has("lab.manage");
  const [sections, subjects, staff] = await Promise.all([
    supabase.from("class_sections").select("id, name, grades(display_name, sort_key)").eq("institution_id", ctx.institution.id).limit(LIMIT),
    supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).order("name").limit(LIMIT),
    manager ? supabase.from("staff").select("id, full_name").eq("institution_id", ctx.institution.id).eq("status", "active").order("full_name").limit(LIMIT) : Promise.resolve({ data: [], error: null }),
  ]);
  check(sections.error);
  check(subjects.error);
  check(staff.error);
  return {
    sections: (sections.data ?? [])
      .sort((a, b) => (a.grades?.sort_key ?? 0) - (b.grades?.sort_key ?? 0) || a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, label: `${s.grades?.display_name ?? ""} ${s.name}`.trim() })),
    subjects: (subjects.data ?? []).map((s) => ({ id: s.id, label: s.name })),
    staff: (staff.data ?? []).map((s) => ({ id: s.id, label: s.full_name })),
  };
}

export interface ExperimentRow {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;
  bookingId: string;
  bookingStaffId: string;
  labId: string;
  lab: string;
  date: string;
  section: string;
  subject: string;
}

export async function schoolLabExperiments(ctx: TenantContext): Promise<ExperimentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_lab_experiments")
    .select("id, title, notes, completed, booking_id, school_lab_bookings!school_lab_experiments_booking_fk(lab_id, date, staff_id, subjects(name), class_sections(name, grades(display_name)), school_labs!school_lab_bookings_lab_fk(name))")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(100);
  check(error);
  return (data ?? []).map((e) => {
    const b = e.school_lab_bookings;
    const cs = b?.class_sections;
    return {
      id: e.id,
      title: e.title,
      notes: e.notes,
      completed: e.completed,
      bookingId: e.booking_id,
      bookingStaffId: b?.staff_id ?? "",
      labId: b?.lab_id ?? "",
      lab: b?.school_labs?.name ?? "Lab",
      date: b?.date ?? "",
      section: cs ? `${cs.grades?.display_name ?? ""} ${cs.name}`.trim() : "Section",
      subject: b?.subjects?.name ?? "Subject",
    };
  });
}

export interface IncidentRow {
  id: string;
  lab: string;
  kind: string;
  severity: string;
  description: string;
  costPaise: number | null;
  createdAt: string;
}

export async function schoolLabIncidents(ctx: TenantContext): Promise<IncidentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_lab_incidents")
    .select("id, kind, severity, description, cost_paise, created_at, school_labs!school_lab_incidents_lab_fk(name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(100);
  check(error);
  return (data ?? []).map((i) => ({
    id: i.id,
    lab: i.school_labs?.name ?? "Lab",
    kind: i.kind,
    severity: i.severity,
    description: i.description,
    costPaise: i.cost_paise === null ? null : Number(i.cost_paise),
    createdAt: i.created_at,
  }));
}

export interface UtilisationRow {
  labId: string;
  bookings: number;
  periodsUsed: number;
}

/** Name-free aggregate: bookings and distinct periods per lab (zero rows included). */
export async function schoolLabUtilisation(ctx: TenantContext, input: UtilisationQueryInput): Promise<UtilisationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_lab_utilisation", { p_institution_id: ctx.institution.id, p_from: input.from, p_to: input.to });
  check(error);
  return (data ?? []).map((r) => ({ labId: r.lab_id, bookings: Number(r.bookings), periodsUsed: Number(r.periods_used) }));
}

export interface SafetyCheck {
  labId: string;
  date: string;
  warnings: SafetyWarning[];
}

/** Deterministic safety check of one lab's register (no model). Holds no person names. */
export async function schoolLabSafetyWarnings(ctx: TenantContext, labId: string): Promise<SafetyCheck> {
  const date = todayInInstitutionTimezone(ctx);
  const equipment = await schoolLabEquipment(ctx, labId);
  return { labId, date, warnings: labSafetyWarnings(equipment, date) };
}
