import "server-only";
// X04-T6 — fee-plans module reads (X04-tasks.md Task 6). `late_fee_rules`
// is finance_roles()-only; `invoice_instalments` / `late_fee_charges` also
// allow the owning guardian/student (RLS, 0087) — these queries rely on
// RLS for scoping rather than re-checking role here, same shape as
// src/modules/finance/queries.ts. Money via that file's paise helpers
// (reuse, not a second money-float fix).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AppError } from "@/lib/actions/result";
import { moneyToPaise, paiseToMoney } from "@/modules/finance/queries";
import type { LedgerExportInput } from "./schemas";

export interface LateFeeRuleRow {
  feeStructureId: string;
  feeStructureName: string;
  gradeName: string;
  academicYearId: string;
  rule: {
    id: string;
    kind: "flat" | "per_day";
    amount: number;
    graceDays: number;
    cap: number | null;
    isActive: boolean;
  } | null;
}

/** Every fee structure of the current academic year, with its late-fee rule or null (ruling "Late-fee rule = one row per fee structure"). */
export async function listLateFeeRules(ctx: TenantContext): Promise<LateFeeRuleRow[]> {
  const supabase = await createClient();

  const { data: year, error: yearError } = await supabase
    .from("academic_years")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw yearError;
  if (!year) return [];

  const { data: structures, error: structuresError } = await supabase
    .from("fee_structures")
    .select("id, name, academic_year_id, grades(display_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", year.id)
    .order("name");
  if (structuresError) throw structuresError;
  if (!structures || structures.length === 0) return [];

  const { data: rules, error: rulesError } = await supabase
    .from("late_fee_rules")
    .select("id, fee_structure_id, kind, amount, grace_days, cap, is_active")
    .eq("institution_id", ctx.institution.id)
    .in(
      "fee_structure_id",
      structures.map((s) => s.id),
    );
  if (rulesError) throw rulesError;
  const byStructure = new Map((rules ?? []).map((r) => [r.fee_structure_id, r]));

  return structures.map((row) => {
    const grade = row.grades as { display_name: string } | null;
    const rule = byStructure.get(row.id);
    return {
      feeStructureId: row.id,
      feeStructureName: row.name,
      gradeName: grade?.display_name ?? "",
      academicYearId: row.academic_year_id,
      rule: rule
        ? {
            id: rule.id,
            kind: rule.kind as "flat" | "per_day",
            amount: paiseToMoney(moneyToPaise(rule.amount)),
            graceDays: rule.grace_days,
            cap: rule.cap == null ? null : paiseToMoney(moneyToPaise(rule.cap)),
            isActive: rule.is_active,
          }
        : null,
    };
  });
}

export interface InstalmentPart {
  seq: number;
  dueOn: string;
  amount: number;
  paidAmount: number;
  status: "paid" | "part_paid" | "due" | "overdue";
}

export interface LateFeeChargeRow {
  chargeDate: string;
  unitSeq: number;
  daysLate: number;
  amount: number;
}

export interface InstalmentPlan {
  invoiceId: string;
  invoiceNo: string;
  total: number;
  paidTotal: number;
  parts: InstalmentPart[];
  lateFees: LateFeeChargeRow[];
}

/** Derived parts (`public.invoice_instalment_status`) + the invoice's late-fee charges. `parts: []` without a plan; `null` when the invoice isn't visible under RLS (another family's, or not in this institution). */
export async function getInstalments(ctx: TenantContext, input: { invoiceId: string }): Promise<InstalmentPlan | null> {
  const supabase = await createClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_no, total, paid_total")
    .eq("id", input.invoiceId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) return null;

  const [{ data: statusRows, error: statusError }, { data: charges, error: chargesError }] = await Promise.all([
    supabase.rpc("invoice_instalment_status", {
      p_institution_id: ctx.institution.id,
      p_invoice_id: input.invoiceId,
    }),
    supabase
      .from("late_fee_charges")
      .select("charge_date, unit_seq, days_late, amount")
      .eq("institution_id", ctx.institution.id)
      .eq("invoice_id", input.invoiceId)
      .order("charge_date"),
  ]);
  if (statusError) throw statusError;
  if (chargesError) throw chargesError;

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoice_no,
    total: paiseToMoney(moneyToPaise(invoice.total)),
    paidTotal: paiseToMoney(moneyToPaise(invoice.paid_total)),
    parts: (statusRows ?? []).map((row) => ({
      seq: row.seq,
      dueOn: row.due_on,
      amount: paiseToMoney(moneyToPaise(row.amount)),
      paidAmount: paiseToMoney(moneyToPaise(row.paid_amount)),
      status: row.status as InstalmentPart["status"],
    })),
    lateFees: (charges ?? []).map((row) => ({
      chargeDate: row.charge_date,
      unitSeq: row.unit_seq,
      daysLate: row.days_late,
      amount: paiseToMoney(moneyToPaise(row.amount)),
    })),
  };
}

// X04-T7 — ruling "Ledger export (Tally + plain CSV)". `public.ledger_voucher_lines`
// (T4) does the voucher grouping/typing in SQL under `ledger_entries` RLS
// (finance roles); this layer only pages it (never trust PostgREST's
// 1,000-row default), maps account -> ledger name, and formats rows for
// the two layouts. CSV itself is the existing generic `?format=csv`
// (src/lib/http/csv.ts) — nothing export-specific here.
export interface TallyRow {
  Date: string;
  "Voucher Type": "Receipt" | "Payment" | "Journal";
  "Voucher No": string;
  "Ledger Name": string;
  "Dr/Cr": "Dr" | "Cr";
  Amount: string;
  Narration: string;
}

export interface PlainLedgerRow {
  date: string;
  voucherType: string;
  voucherNo: string;
  account: string;
  ledgerName: string;
  debit: number;
  credit: number;
  narration: string;
  admissionNo: string | null;
}

const LEDGER_EXPORT_PAGE_SIZE = 1000;
const LEDGER_EXPORT_MAX_ROWS = 20000;

const DEFAULT_LEDGER_NAMES: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  fees_receivable: "Fees Receivable",
  fee_income: "Fee Income",
  concession_expense: "Fee Concession",
};

/** "2026-11-05" -> "05-11-2026" (ruling: Tally dates `DD-MM-YYYY`). */
function toDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function resolveLedgerName(
  input: LedgerExportInput,
  account: string,
  chargeHead: string | null,
): string {
  switch (account) {
    case "cash":
      return input.cashLedger ?? DEFAULT_LEDGER_NAMES.cash;
    case "bank":
      return input.bankLedger ?? DEFAULT_LEDGER_NAMES.bank;
    case "fees_receivable":
      return input.receivableLedger ?? DEFAULT_LEDGER_NAMES.fees_receivable;
    case "fee_income":
      return chargeHead === "late_fee"
        ? input.lateFeeLedger ?? "Late Fee Income"
        : input.incomeLedger ?? DEFAULT_LEDGER_NAMES.fee_income;
    case "concession_expense":
      return input.concessionLedger ?? DEFAULT_LEDGER_NAMES.concession_expense;
    default:
      return account;
  }
}

/** Pages `public.ledger_voucher_lines` (1,000/page) for the date range; > 20,000 lines -> `validation_failed` (ruling). `layout: "plain"` returns money as numbers via the paise helpers; `layout: "tally"` returns TallyPrime's flat-string shape. CSV export is the existing generic `?format=csv` route handler. */
export async function ledgerExport(
  ctx: TenantContext,
  input: LedgerExportInput,
): Promise<TallyRow[] | PlainLedgerRow[]> {
  const supabase = await createClient();

  const rows: {
    entry_date: string;
    voucher_type: string;
    voucher_no: string;
    charge_head: string | null;
    account: string;
    debit: number;
    credit: number;
    memo: string;
    admission_no: string | null;
  }[] = [];
  for (let from = 0; ; from += LEDGER_EXPORT_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .rpc("ledger_voucher_lines", {
        p_institution_id: ctx.institution.id,
        p_from: input.from,
        p_to: input.to,
        p_receipts_only: input.include === "receipts",
      })
      .range(from, from + LEDGER_EXPORT_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((page ?? []) as typeof rows));
    if (rows.length > LEDGER_EXPORT_MAX_ROWS) {
      throw new AppError("validation_failed", "Narrow the date range.");
    }
    if (!page || page.length < LEDGER_EXPORT_PAGE_SIZE) break;
  }

  if (input.layout === "tally") {
    return rows.map((row): TallyRow => {
      const debitPaise = moneyToPaise(row.debit);
      const creditPaise = moneyToPaise(row.credit);
      const amountPaise = debitPaise > 0 ? debitPaise : creditPaise;
      return {
        Date: toDdMmYyyy(row.entry_date),
        "Voucher Type": row.voucher_type as TallyRow["Voucher Type"],
        "Voucher No": row.voucher_no,
        "Ledger Name": resolveLedgerName(input, row.account, row.charge_head),
        "Dr/Cr": debitPaise > 0 ? "Dr" : "Cr",
        Amount: paiseToMoney(amountPaise).toFixed(2),
        Narration: row.admission_no ? `${row.memo} · ${row.admission_no}` : row.memo,
      };
    });
  }

  return rows.map((row): PlainLedgerRow => ({
    date: row.entry_date,
    voucherType: row.voucher_type,
    voucherNo: row.voucher_no,
    account: row.account,
    ledgerName: resolveLedgerName(input, row.account, row.charge_head),
    debit: paiseToMoney(moneyToPaise(row.debit)),
    credit: paiseToMoney(moneyToPaise(row.credit)),
    narration: row.memo,
    admissionNo: row.admission_no,
  }));
}
