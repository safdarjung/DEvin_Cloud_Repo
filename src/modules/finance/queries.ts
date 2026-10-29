import "server-only";
// T-031 — finance module reads (06 §W9). Always the signed-in user's RLS
// client (CLAUDE.md) — fee_structures/fee_components/fee_assignments/
// concessions are finance_roles()-only (05 §5), invoices/invoice_lines also
// allow guardian/student own-scope, which these queries rely on for scoping
// rather than re-checking role here.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface PickerOption {
  id: string;
  label: string;
}

/** Thin pickers for the structure/invoice forms — any authenticated member may read these (not finance-scoped). */
export async function listAcademicYears(ctx: TenantContext): Promise<PickerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("institution_id", ctx.institution.id)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((y) => ({ id: y.id, label: y.name }));
}

export async function listGradeOptions(ctx: TenantContext): Promise<PickerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grades")
    .select("id, display_name")
    .eq("institution_id", ctx.institution.id)
    .order("sort_key");
  if (error) throw error;
  return (data ?? []).map((g) => ({ id: g.id, label: g.display_name }));
}

export async function listTermOptions(ctx: TenantContext, academicYearId?: string): Promise<PickerOption[]> {
  const supabase = await createClient();
  let query = supabase
    .from("terms")
    .select("id, name, sequence")
    .eq("institution_id", ctx.institution.id)
    .order("sequence");
  if (academicYearId) query = query.eq("academic_year_id", academicYearId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, label: t.name }));
}

export interface FeeComponentOption {
  id: string;
  head: string;
  amount: number;
  frequency: string;
  appliesToNewOnly: boolean;
}

export interface FeeStructureSummary {
  id: string;
  name: string;
  academicYearId: string;
  gradeId: string;
  isDefault: boolean;
  componentCount: number;
}

export async function listFeeStructures(
  ctx: TenantContext,
  filters: { academicYearId?: string; gradeId?: string } = {},
): Promise<FeeStructureSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("fee_structures")
    .select("id, name, academic_year_id, grade_id, is_default, fee_components(count)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (filters.academicYearId) query = query.eq("academic_year_id", filters.academicYearId);
  if (filters.gradeId) query = query.eq("grade_id", filters.gradeId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    academicYearId: row.academic_year_id,
    gradeId: row.grade_id,
    isDefault: row.is_default,
    componentCount: (row.fee_components as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export interface FeeStructureDetail extends FeeStructureSummary {
  components: FeeComponentOption[];
}

export async function getFeeStructure(ctx: TenantContext, id: string): Promise<FeeStructureDetail | null> {
  const supabase = await createClient();
  const { data: structure, error } = await supabase
    .from("fee_structures")
    .select("id, name, academic_year_id, grade_id, is_default")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!structure) return null;

  const { data: components, error: componentsError } = await supabase
    .from("fee_components")
    .select("id, head, amount, frequency, applies_to_new_only")
    .eq("fee_structure_id", id)
    .eq("institution_id", ctx.institution.id)
    .order("head");
  if (componentsError) throw componentsError;

  return {
    id: structure.id,
    name: structure.name,
    academicYearId: structure.academic_year_id,
    gradeId: structure.grade_id,
    isDefault: structure.is_default,
    componentCount: components?.length ?? 0,
    components: (components ?? []).map((c) => ({
      id: c.id,
      head: c.head,
      amount: Number(c.amount),
      frequency: c.frequency,
      appliesToNewOnly: c.applies_to_new_only,
    })),
  };
}

export interface InvoiceSummary {
  id: string;
  invoiceNo: string;
  studentId: string;
  studentName: string;
  status: string;
  total: number;
  paidTotal: number;
  dueOn: string | null;
}

interface InvoiceSummaryRow {
  id: string;
  invoice_no: string;
  student_id: string;
  status: string;
  total: number;
  paid_total: number;
  due_on: string | null;
  students: { first_name: string; last_name: string | null } | null;
}

// Phase 2 review (LOW): this mapping was copied in listInvoices,
// listInvoicesForStudent and getInvoice — extracted once.
function toInvoiceSummary(row: InvoiceSummaryRow): InvoiceSummary {
  const student = row.students;
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    studentId: row.student_id,
    studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
    status: row.status,
    total: Number(row.total),
    paidTotal: Number(row.paid_total),
    dueOn: row.due_on,
  };
}

export async function listInvoices(
  ctx: TenantContext,
  filters: { termId?: string; status?: string; gradeId?: string } = {},
): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id, invoice_no, student_id, status, total, paid_total, due_on, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .order("due_on", { ascending: true, nullsFirst: false });
  if (filters.termId) query = query.eq("term_id", filters.termId);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;
  let rows = data ?? [];

  if (filters.gradeId) {
    const { data: enrolments, error: enrolError } = await supabase
      .from("enrolments")
      .select("student_id, class_sections!inner(grade_id)")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .eq("class_sections.grade_id", filters.gradeId);
    if (enrolError) throw enrolError;
    const studentIds = new Set((enrolments ?? []).map((e) => e.student_id));
    rows = rows.filter((r) => studentIds.has(r.student_id));
  }

  return rows.map((row) => toInvoiceSummary(row as InvoiceSummaryRow));
}

// T-028 — per-student invoice list for the student profile page (the
// packet's fallback: render a minimal table from here if T-032's
// StudentInvoices component isn't merged yet; it isn't).
export async function listInvoicesForStudent(ctx: TenantContext, studentId: string): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, status, total, paid_total, due_on, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toInvoiceSummary(row as InvoiceSummaryRow));
}

export interface InvoiceLineDetail {
  head: string;
  description: string;
  amount: number;
  concessionAmount: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotal: number;
  concessionTotal: number;
  lines: InvoiceLineDetail[];
}

export async function getInvoice(ctx: TenantContext, id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_no, student_id, status, subtotal, concession_total, total, paid_total, due_on, students(first_name, last_name)",
    )
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) return null;

  const { data: lines, error: linesError } = await supabase
    .from("invoice_lines")
    .select("head, description, amount, concession_amount")
    .eq("invoice_id", id)
    .eq("institution_id", ctx.institution.id)
    .order("head");
  if (linesError) throw linesError;

  return {
    ...toInvoiceSummary(invoice as InvoiceSummaryRow),
    subtotal: Number(invoice.subtotal),
    concessionTotal: Number(invoice.concession_total),
    lines: (lines ?? []).map((l) => ({
      head: l.head,
      description: l.description,
      amount: Number(l.amount),
      concessionAmount: Number(l.concession_amount),
    })),
  };
}
