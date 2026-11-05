import "server-only";
// X07-T8 — visitors.* reads. Always the signed-in user's RLS client
// (CLAUDE.md); the institution_id filters below are defense in depth,
// same shape as every other queries.ts (mirrors src/modules/transport/queries.ts,
// src/modules/facilities/queries.ts for the per-row timezone helper).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { GatePassListInput, VisitorListInput } from "./schemas";

const LATEST_LIMIT = 200;

function institutionTimezone(ctx: TenantContext): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  return locale.success ? locale.data.timezone : "Asia/Kolkata";
}

/**
 * [start, end) UTC instants bounding one institution-local calendar day
 * (mirrors src/lib/ai/usage.ts's startOfDayInTimezone offset math,
 * parameterised by an explicit date rather than "now").
 */
function dayRangeInTimezone(timeZone: string, dateIso: string): { start: string; end: string } {
  const candidateUtc = new Date(`${dateIso}T00:00:00Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(candidateUtc)) parts[type] = value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asUtc - candidateUtc.getTime();
  const start = new Date(candidateUtc.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface VisitorRow {
  id: string;
  fullName: string;
  phone: string;
  purpose: string;
  meetingWith: string;
  idType: string | null;
  idLast4: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
}

/** Front-desk visitor log (visitor.manage). `date` filters to that institution-local day; absent = latest 200, checked_in_at desc. */
export async function visitorsList(ctx: TenantContext, input: VisitorListInput): Promise<VisitorRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("visitor_entries")
    .select("id, full_name, phone, purpose, meeting_with, id_type, id_last4, checked_in_at, checked_out_at, staff(full_name)")
    .eq("institution_id", ctx.institution.id)
    .order("checked_in_at", { ascending: false });

  if (input.date) {
    const { start, end } = dayRangeInTimezone(institutionTimezone(ctx), input.date);
    query = query.gte("checked_in_at", start).lt("checked_in_at", end);
  } else {
    query = query.limit(LATEST_LIMIT);
  }
  if (input.onSite) query = query.is("checked_out_at", null);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const host = row.staff as { full_name: string } | null;
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      purpose: row.purpose,
      meetingWith: host?.full_name ?? row.meeting_with ?? "",
      idType: row.id_type,
      idLast4: row.id_last4,
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
    };
  });
}

export interface GatePassRow {
  id: string;
  studentId: string;
  studentName: string;
  class: string;
  reason: string;
  collectorName: string;
  collectorRelation: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  exitedAt: string | null;
}

interface GatePassStudentEmbed {
  first_name: string;
  last_name: string | null;
  enrolments: { status: string; class_sections: { name: string; grades: { code: string } | null } | null }[] | null;
}

/** Gate pass list (gatepass.manage); RLS narrows a teacher to their own-section students. `date` filters requested_at to that institution-local day; absent = latest 200, requested_at desc. */
export async function visitorsGatePasses(ctx: TenantContext, input: GatePassListInput): Promise<GatePassRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("gate_passes")
    .select(
      "id, student_id, reason, collector_name, collector_relation, status, requested_at, decided_at, exited_at, students(first_name, last_name, enrolments(status, class_sections(name, grades(code))))",
    )
    .eq("institution_id", ctx.institution.id)
    .order("requested_at", { ascending: false });

  if (input.status) query = query.eq("status", input.status);
  if (input.date) {
    const { start, end } = dayRangeInTimezone(institutionTimezone(ctx), input.date);
    query = query.gte("requested_at", start).lt("requested_at", end);
  } else {
    query = query.limit(LATEST_LIMIT);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const student = row.students as GatePassStudentEmbed | null;
    const active = (student?.enrolments ?? []).find((e) => e.status === "active");
    const grade = active?.class_sections?.grades?.code;
    const section = active?.class_sections?.name;
    return {
      id: row.id,
      studentId: row.student_id,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      class: grade && section ? `${grade}-${section}` : "",
      reason: row.reason,
      collectorName: row.collector_name,
      collectorRelation: row.collector_relation,
      status: row.status,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      exitedAt: row.exited_at,
    };
  });
}

export interface PickupListRow {
  kind: "guardian" | "pickup";
  id: string;
  fullName: string;
  relation: string;
  phoneMasked: string;
}

/** Last 4 digits visible, the rest masked (DPDP — rulings §Queries masking). */
function maskPhone(phone: string): string {
  return "*".repeat(Math.max(0, phone.length - 4)) + phone.slice(-4);
}

/** Guardians (primary first) then pickup persons (created_at) authorised to collect a student (student.read); rows RLS hides are simply absent. */
export async function visitorsPickupList(ctx: TenantContext, studentId: string): Promise<PickupListRow[]> {
  const supabase = await createClient();
  const [guardiansRes, pickupRes] = await Promise.all([
    supabase
      .from("guardian_students")
      .select("guardian_id, relationship, is_primary, guardians(full_name, phone)")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("pickup_persons")
      // phone_masked (DB-generated column, security review MED-1) — the raw
      // phone column is not grantable to authenticated, see migration 0090.
      .select("id, full_name, relation, phone_masked, created_at")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: true }),
  ]);
  if (guardiansRes.error) throw guardiansRes.error;
  if (pickupRes.error) throw pickupRes.error;

  const guardianRows: PickupListRow[] = (guardiansRes.data ?? []).map((row) => {
    const guardian = row.guardians as { full_name: string; phone: string } | null;
    return {
      kind: "guardian",
      id: row.guardian_id,
      fullName: guardian?.full_name ?? "",
      relation: row.relationship,
      phoneMasked: maskPhone(guardian?.phone ?? ""),
    };
  });

  const pickupRows: PickupListRow[] = (pickupRes.data ?? []).map((row) => ({
    kind: "pickup",
    id: row.id,
    fullName: row.full_name,
    relation: row.relation,
    phoneMasked: row.phone_masked ?? "",
  }));

  return [...guardianRows, ...pickupRows];
}
