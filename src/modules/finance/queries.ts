import "server-only";
// T-031 — finance module reads (06 §W9). Always the signed-in user's RLS
// client (CLAUDE.md) — fee_structures/fee_components/fee_assignments/
// concessions are finance_roles()-only (05 §5), invoices/invoice_lines also
// allow guardian/student own-scope, which these queries rely on for scoping
// rather than re-checking role here.
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { CollectionReportInput } from "./schemas";

export interface PickerOption {
  id: string;
  label: string;
}

// T-032 — shared by `recordPayment` (actions.ts, which as a "use server"
// file may only export async functions, so this pure helper lives here
// instead) and the invoice detail page, which needs the same list to pass
// into `RecordPaymentDialog` as a prop.
export function paymentModesFor(settings: Record<string, unknown>): string[] {
  const finance = settings.finance;
  if (typeof finance !== "object" || finance === null) return [];
  const modes = (finance as Record<string, unknown>).payment_modes;
  return Array.isArray(modes) ? modes.filter((m): m is string => typeof m === "string") : [];
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

// T-032 — 06 §W9. Rendered from `receipts.snapshot` only (packet security
// rule 2: "the receipt must not change if names change later") — no join to
// students/invoices here.
// T-032 phase 2 (20261028000021): `app.record_payment` now captures the
// display fields (school/student name, admission no, class/section,
// invoice/term/receipt number) into the snapshot at payment time, so a
// later rename never changes an already-printed receipt. Older receipts
// (written before this migration) won't have these keys — the string
// fields fall back to an empty string rather than "null"/"undefined" on
// the page.
export interface ReceiptHeadSnapshot {
  head: string;
  amount: number;
  concessionAmount: number;
}

export interface ReceiptSnapshot {
  invoiceId: string;
  studentId: string;
  amount: number;
  mode: string;
  reference: string | null;
  receivedAt: string;
  receiptNo: string;
  schoolName: string;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  invoiceNo: string;
  termName: string;
  heads: ReceiptHeadSnapshot[];
}

export interface ReceiptReversal {
  kind: string;
  reason: string;
  reversedAt: string;
}

export interface ReceiptDetail {
  id: string;
  receiptNo: string;
  financialYear: string;
  createdAt: string;
  snapshot: ReceiptSnapshot;
  reversal: ReceiptReversal | null;
}

function toReceiptHeadSnapshot(h: Record<string, unknown>): ReceiptHeadSnapshot {
  return { head: String(h.head), amount: Number(h.amount), concessionAmount: Number(h.concession_amount) };
}

/**
 * RLS scopes to finance roles or the receipt's own student's guardian/student
 * (05 §5); the explicit `institution_id` filter plus null-check still gives a
 * clean `not_found` instead of relying on RLS alone (packet rule 2).
 *
 * M12-T7: `reversal` (void/refund/cheque_bounce) is a second read of
 * `payment_reversals` by `payment_id` — that table's own RLS (mirrors
 * `receipts_select`, 0074) already scopes it to the same finance-roles-or-
 * this-student audience, so no extra institution filter is needed beyond
 * what the row's own policy already enforces for this signed-in client.
 */
export async function getReceipt(ctx: TenantContext, id: string): Promise<ReceiptDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("id, receipt_no, financial_year, created_at, snapshot, payment_id")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: reversalRow, error: reversalError } = await supabase
    .from("payment_reversals")
    .select("kind, reason, created_at")
    .eq("payment_id", data.payment_id)
    .maybeSingle();
  if (reversalError) throw reversalError;

  const snap = data.snapshot as Record<string, unknown>;
  return {
    id: data.id,
    receiptNo: data.receipt_no,
    financialYear: data.financial_year,
    createdAt: data.created_at,
    reversal: reversalRow ? { kind: reversalRow.kind, reason: reversalRow.reason, reversedAt: reversalRow.created_at } : null,
    snapshot: {
      invoiceId: String(snap.invoice_id),
      studentId: String(snap.student_id),
      amount: Number(snap.amount),
      mode: String(snap.mode),
      reference: snap.reference == null ? null : String(snap.reference),
      receivedAt: String(snap.received_at),
      receiptNo: snap.receipt_no == null ? "" : String(snap.receipt_no),
      schoolName: snap.school_name == null ? "" : String(snap.school_name),
      studentName: snap.student_name == null ? "" : String(snap.student_name),
      admissionNo: snap.admission_no == null ? "" : String(snap.admission_no),
      classLabel: snap.class_label == null ? "" : String(snap.class_label),
      invoiceNo: snap.invoice_no == null ? "" : String(snap.invoice_no),
      termName: snap.term_name == null ? "" : String(snap.term_name),
      heads: Array.isArray(snap.heads) ? (snap.heads as Record<string, unknown>[]).map(toReceiptHeadSnapshot) : [],
    },
  };
}

export interface ReceiptSummary {
  id: string;
  receiptNo: string;
  createdAt: string;
  amount: number;
}

/**
 * T-034 fix round 1 — guardian/student portal fees tab. `receipts` itself
 * has no `student_id` column (only `payments.invoice_id` -> `invoices.student_id`,
 * see `getReceipt`'s comment), so the student filter is pushed into the
 * query via the `payments`/`invoices` embed + `!inner` joins, not fetched
 * in full and filtered in JS. `receipts_select` RLS (05 §5) already scopes
 * every row returned here to finance roles or the receipt's own
 * guardian/student; this filter narrows further to one specific child.
 */
export async function listReceiptsForStudent(ctx: TenantContext, studentId: string): Promise<ReceiptSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("id, receipt_no, created_at, snapshot, payments!inner(invoice_id, invoices!inner(student_id))")
    .eq("institution_id", ctx.institution.id)
    .eq("payments.invoices.student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    receiptNo: row.receipt_no,
    createdAt: row.created_at,
    amount: Number((row.snapshot as Record<string, unknown>).amount ?? 0),
  }));
}

// T-032 Fix round 1 (code review, MEDIUM — money float): `numeric(12,2)`
// columns come back over PostgREST as a decimal string even though the
// generated `Database` type says `number` (the same gap every `Number(...)`
// single-value read in this file already papers over) — summing those with
// `+` after `Number(...)` goes through IEEE754 doubles and can make a
// genuinely balanced ledger compare unequal with `===`. These two parse the
// string directly into an integer (no float multiply), so sums and
// comparisons are exact; only the final display value goes back through
// `Number()`, once, on a clean two-decimal string it built itself.
export function moneyToPaise(raw: string | number): number {
  const text = typeof raw === "number" ? raw.toString() : raw;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const paddedFraction = (fraction + "00").slice(0, 2);
  const paise = Number(`${whole || "0"}${paddedFraction}`);
  return negative ? -paise : paise;
}

export function paiseToMoney(paise: number): number {
  const negative = paise < 0;
  const absolute = Math.abs(Math.trunc(paise));
  const rupees = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const value = Number(`${rupees}.${String(cents).padStart(2, "0")}`);
  return negative ? -value : value;
}

export interface LedgerEntry {
  id: string;
  entryDate: string;
  account: string;
  debit: number;
  credit: number;
  memo: string | null;
  invoiceId: string | null;
  paymentId: string | null;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  totalDebit: number;
  totalCredit: number;
  /** Computed from the integer-paise sums, not from `totalDebit === totalCredit` (money-float fix round 1). */
  balanced: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface LedgerFilters {
  from: string;
  to: string;
  account?: string;
}

const MAX_LEDGER_PAGE_SIZE = 100;
const DEFAULT_LEDGER_PAGE_SIZE = 50;

/** ledger_entries is finance_roles()-only (not guardian-scoped, 05 §5) — RLS alone is the gate here; no student/guardian call path renders this page. */
export async function listLedgerEntries(
  ctx: TenantContext,
  filters: LedgerFilters,
  page = 1,
  pageSize = DEFAULT_LEDGER_PAGE_SIZE,
): Promise<LedgerPage> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.from) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
    throw new Error("from/to must be ISO dates (YYYY-MM-DD).");
  }
  if (filters.from > filters.to) {
    throw new Error("from must not be after to.");
  }

  const size = Math.min(Math.max(Math.trunc(pageSize) || DEFAULT_LEDGER_PAGE_SIZE, 1), MAX_LEDGER_PAGE_SIZE);
  const safePage = Math.max(Math.trunc(page) || 1, 1);

  const supabase = await createClient();

  let listQuery = supabase
    .from("ledger_entries")
    .select("id, entry_date, account, debit, credit, memo, invoice_id, payment_id", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .gte("entry_date", filters.from)
    .lte("entry_date", filters.to)
    .order("entry_date", { ascending: false })
    .range((safePage - 1) * size, safePage * size - 1);
  if (filters.account) listQuery = listQuery.eq("account", filters.account);

  // DBT-40 fix: totals from the `ledger_totals` SQL function (sums every
  // matching row server-side), never from a PostgREST select — the old
  // `sumQuery` here had no `.range()`, so `max_rows = 1000`
  // (supabase/config.toml) silently truncated it on any institution with
  // more than 1,000 ledger rows in the filtered range.
  const totalsQuery = supabase
    .rpc("ledger_totals", {
      p_institution_id: ctx.institution.id,
      p_from: filters.from,
      p_to: filters.to,
      ...(filters.account ? { p_account: filters.account } : {}),
    })
    .single();

  const [{ data, error, count }, { data: totalsRow, error: totalsError }] = await Promise.all([listQuery, totalsQuery]);
  if (error) throw error;
  if (totalsError) throw totalsError;

  const totalsPaise = {
    debitPaise: moneyToPaise(totalsRow.total_debit),
    creditPaise: moneyToPaise(totalsRow.total_credit),
  };

  return {
    entries: (data ?? []).map((r) => ({
      id: r.id,
      entryDate: r.entry_date,
      account: r.account,
      debit: Number(r.debit),
      credit: Number(r.credit),
      memo: r.memo,
      invoiceId: r.invoice_id,
      paymentId: r.payment_id,
    })),
    totalDebit: paiseToMoney(totalsPaise.debitPaise),
    totalCredit: paiseToMoney(totalsPaise.creditPaise),
    balanced: totalsPaise.debitPaise === totalsPaise.creditPaise,
    page: safePage,
    pageSize: size,
    totalCount: count ?? 0,
  };
}

export interface DefaulterRow {
  studentId: string;
  studentName: string;
  invoiceId: string;
  invoiceNo: string;
  total: number;
  paidTotal: number;
  outstanding: number;
  dueOn: string | null;
}

/** Outstanding (issued/part_paid) invoices for a term — fully paid and cancelled invoices are excluded (AC4). invoices RLS also allows the owning guardian/student, but defaulters is a staff-only page (gated by finance.read + role in practice); no guardian call path renders it. */
export async function listDefaulters(ctx: TenantContext, filters: { termId: string }): Promise<DefaulterRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_no, student_id, total, paid_total, due_on, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("term_id", filters.termId)
    .in("status", ["issued", "part_paid"])
    .order("due_on", { ascending: true, nullsFirst: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const student = row.students as { first_name: string; last_name: string | null } | null;
    return {
      studentId: row.student_id,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      invoiceId: row.id,
      invoiceNo: row.invoice_no,
      total: Number(row.total),
      paidTotal: Number(row.paid_total),
      // Money-float fix round 1: subtract in integer paise, not floats.
      outstanding: paiseToMoney(moneyToPaise(row.total) - moneyToPaise(row.paid_total)),
      dueOn: row.due_on,
    };
  });
}

// dashboard — T-039.

export interface TermCollectionSummary {
  termId: string;
  invoiceCount: number;
  duePaise: number;
  collectedPaise: number;
}

/** Collected vs due for one term, summed in integer paise (CLAUDE.md rule 4). DBT-40 fix: totals from the `term_collection_totals` SQL function (sums every matching row server-side), not a PostgREST select — the old select here had no `.range()`, so `max_rows = 1000` silently truncated a term with more than 1,000 invoices. */
export async function termCollectionSummary(ctx: TenantContext, termId: string): Promise<TermCollectionSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("term_collection_totals", { p_institution_id: ctx.institution.id, p_term_id: termId })
    .single();
  if (error) throw error;

  return {
    termId,
    invoiceCount: Number(data.invoice_count),
    duePaise: moneyToPaise(data.due),
    collectedPaise: moneyToPaise(data.collected),
  };
}

// M12-T9 — finance.collectionReport (06 rulings). Wraps
// `public.finance_collection_report` (20261028000074), `security invoker`
// over tables already RLS-scoped to finance roles — no role check here.
export interface CollectionReportRow {
  groupKey: string;
  groupLabel: string;
  invoiceCount: number;
  paymentCount: number;
  billed: number | null;
  collected: number;
  reversed: number;
  outstanding: number | null;
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Converts a possibly-null numeric (string or number, per the money-float comment above) to a rupee value via the integer-paise round trip. */
function toMoneyOrNull(raw: string | number | null): number | null {
  return raw === null ? null : paiseToMoney(moneyToPaise(raw));
}

export async function collectionReport(ctx: TenantContext, input: CollectionReportInput): Promise<CollectionReportRow[]> {
  const supabase = await createClient();

  let academicYearId = input.academicYearId;
  if (!academicYearId) {
    const { data: year, error: yearError } = await supabase
      .from("academic_years")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("is_current", true)
      .maybeSingle();
    if (yearError) throw yearError;
    if (!year) return [];
    academicYearId = year.id;
  }

  if (input.termId) {
    const { data: term, error: termError } = await supabase
      .from("terms")
      .select("id")
      .eq("id", input.termId)
      .eq("institution_id", ctx.institution.id)
      .eq("academic_year_id", academicYearId)
      .maybeSingle();
    if (termError) throw termError;
    if (!term) throw new AppError("validation_failed", "Term does not belong to the academic year.");
  }

  const { data, error } = await supabase.rpc("finance_collection_report", {
    p_institution_id: ctx.institution.id,
    p_academic_year_id: academicYearId,
    p_term_id: input.termId,
    p_group_by: input.groupBy,
  });
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    groupKey: row.group_key,
    groupLabel: row.group_label,
    invoiceCount: Number(row.invoice_count),
    paymentCount: Number(row.payment_count),
    billed: toMoneyOrNull(row.billed),
    collected: toMoneyOrNull(row.collected) ?? 0,
    reversed: toMoneyOrNull(row.reversed) ?? 0,
    outstanding: toMoneyOrNull(row.outstanding),
  }));
}
