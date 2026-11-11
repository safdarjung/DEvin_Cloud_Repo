import "server-only";
// Compliance reads — the signed-in user's RLS client (owner/principal/admin/accountant).
// Status is computed here from due_on with complianceStatus(); never stored.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { complianceStatus, type ComplianceStatus } from "./status";

const EVENT_LIMIT = 500;

function check(error: unknown): void {
  if (!error) return;
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface ComplianceItemRow {
  id: string;
  title: string;
  category: string;
  authority: string | null;
  referenceNo: string | null;
  dueOn: string;
  renewEveryMonths: number | null;
  ownerStaffId: string | null;
  ownerName: string | null;
  notes: string | null;
  status: ComplianceStatus;
}

export interface ComplianceEventRow {
  id: string;
  itemId: string;
  renewedOn: string;
  newDueOn: string;
  note: string | null;
  documentId: string | null;
  documentName: string | null;
}

export async function complianceItems(ctx: TenantContext, filter: { category?: string; status?: ComplianceStatus } = {}): Promise<ComplianceItemRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("compliance_items")
    .select("id, title, category, authority, reference_no, due_on, renew_every_months, owner_staff_id, notes, owner:owner_staff_id(full_name)")
    .eq("institution_id", ctx.institution.id)
    .order("due_on", { ascending: true })
    .order("title", { ascending: true });
  if (filter.category) q = q.eq("category", filter.category);
  const { data, error } = await q;
  check(error);
  const today = todayInInstitutionTimezone(ctx);
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      authority: r.authority,
      referenceNo: r.reference_no,
      dueOn: r.due_on,
      renewEveryMonths: r.renew_every_months,
      ownerStaffId: r.owner_staff_id,
      ownerName: r.owner?.full_name ?? null,
      notes: r.notes,
      status: complianceStatus(r.due_on, today),
    }))
    .filter((r) => !filter.status || r.status === filter.status);
}

/** Name-free aggregate: item counts by category x status (public.compliance_summary). */
export async function complianceSummary(ctx: TenantContext): Promise<{ category: string; status: ComplianceStatus; count: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("compliance_summary", { p_institution_id: ctx.institution.id });
  check(error);
  return (data ?? []).map((r) => ({ category: r.category, status: r.status as ComplianceStatus, count: r.item_count }));
}

export async function complianceEvents(ctx: TenantContext): Promise<ComplianceEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("compliance_events")
    .select("id, item_id, renewed_on, new_due_on, note, document_id, doc:document_id(file_name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT);
  check(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    itemId: r.item_id,
    renewedOn: r.renewed_on,
    newDueOn: r.new_due_on,
    note: r.note,
    documentId: r.document_id,
    documentName: r.doc?.file_name ?? null,
  }));
}

export async function complianceOwnerOptions(ctx: TenantContext): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("full_name")
    .limit(200);
  check(error);
  return (data ?? []).map((s) => ({ id: s.id, label: s.full_name }));
}
