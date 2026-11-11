// Features-18 #8 — expenses (migration 0117). Money is integer paise end to
// end: rupee text from a form is parsed with string maths only (no floats).
// Pure aggregation helpers live here too so they are unit-testable (payroll
// precedent). Relative + .ts import: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";

export const EXPENSE_LIMITED_NOTE = "Separate expense register. Not posted to the ledger.";

/**
 * Strict rupee text -> integer paise: "1500", "1500.5", "1500.50". No sign,
 * commas, exponent, leading zeros or 3+ decimals; at most ₹9,99,99,999.99.
 * Null when the text is not that shape.
 */
export function rupeesToPaise(text: string): number | null {
  const m = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const rupees = z
  .string()
  .trim()
  .transform((text, c) => {
    const paise = rupeesToPaise(text);
    if (paise === null || paise === 0) {
      c.addIssue({ code: "custom", message: "Enter rupees above zero, like 1500 or 1500.50." });
      return z.NEVER;
    }
    return paise;
  });

export const ExpenseRecordSchema = z
  .object({
    categoryId: uuid,
    amount: rupees,
    spentOn: isoDate,
    payee: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().min(1).max(200),
  })
  .strict()
  .transform(({ amount, ...rest }) => ({ ...rest, amountPaise: amount }));
export type ExpenseRecordInput = z.infer<typeof ExpenseRecordSchema>;

export const ExpenseVoidSchema = z.object({ id: uuid, reason: z.string().trim().min(5).max(200) }).strict();
export type ExpenseVoidInput = z.infer<typeof ExpenseVoidSchema>;

const categoryName = z.string().trim().min(1).max(60);
export const ExpenseCategoryCreateSchema = z.object({ name: categoryName }).strict();
export const ExpenseCategoryUpdateSchema = z.object({ id: uuid, name: categoryName, isActive: z.boolean() }).strict();

export const ExpenseBudgetSetSchema = z
  .object({ categoryId: uuid, periodStart: isoDate, periodEnd: isoDate, amount: rupees })
  .strict()
  .refine((d) => d.periodEnd >= d.periodStart, { message: "Period end must be on or after the start.", path: ["periodEnd"] })
  .transform(({ amount, ...rest }) => ({ ...rest, amountPaise: amount }));
export type ExpenseBudgetSetInput = z.infer<typeof ExpenseBudgetSetSchema>;

const fromBeforeTo = (d: { from?: string; to?: string }) => !d.from || !d.to || d.from <= d.to;

export const ExpenseListSchema = z
  .object({
    categoryId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(fromBeforeTo, { message: "From must be on or before To.", path: ["from"] });
export type ExpenseListInput = z.infer<typeof ExpenseListSchema>;
export type ExpenseFilters = Omit<ExpenseListInput, "page">;

export const ExpenseEmptySchema = z.object({}).strict();
export const ExpenseMonthlyTotalsSchema = z.object({ months: z.number().int().min(1).max(24).default(6) }).strict();
export const ExpenseBudgetVsActualSchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine(fromBeforeTo, { message: "From must be on or before To.", path: ["from"] });

// ---------------------------------------------------------------------------
// Pure aggregation helpers (integer paise, no floats).
// ---------------------------------------------------------------------------

export interface AmountRow {
  category_id: string;
  spent_on: string;
  amount_paise: number;
}

/** Indian financial year (1 April - 31 March) containing `dateIso`. */
export function financialYearOf(dateIso: string): { from: string; to: string } {
  const y = Number(dateIso.slice(0, 4));
  const start = Number(dateIso.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** `n` month keys (YYYY-MM), ascending, ending at the month of `dateIso`. */
export function monthKeys(dateIso: string, n: number): string[] {
  const end = Number(dateIso.slice(0, 4)) * 12 + Number(dateIso.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => {
    const m = end - (n - 1) + i;
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

/** Net total per month key (reversals included, so a void nets to zero); months outside `keys` are ignored. */
export function sumByMonth(keys: string[], rows: AmountRow[]): { month: string; totalPaise: number }[] {
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = r.spent_on.slice(0, 7);
    const t = totals.get(k);
    if (t !== undefined) totals.set(k, t + r.amount_paise);
  }
  return keys.map((month) => ({ month, totalPaise: totals.get(month)! }));
}

export interface BudgetRow {
  id: string;
  category_id: string;
  period_start: string;
  period_end: string;
  amount_paise: number;
  expense_categories: { name: string } | null;
}

export interface BudgetVsActualRow {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  periodStart: string;
  periodEnd: string;
  budgetPaise: number;
  actualPaise: number;
  overByPaise: number;
}

/** Actual = net spend of the budget's category with spent_on inside its period (inclusive). */
export function budgetVsActualRows(budgets: BudgetRow[], rows: AmountRow[]): BudgetVsActualRow[] {
  return budgets.map((b) => {
    let actualPaise = 0;
    for (const r of rows) {
      if (r.category_id === b.category_id && r.spent_on >= b.period_start && r.spent_on <= b.period_end) actualPaise += r.amount_paise;
    }
    return {
      budgetId: b.id,
      categoryId: b.category_id,
      categoryName: b.expense_categories?.name ?? "",
      periodStart: b.period_start,
      periodEnd: b.period_end,
      budgetPaise: b.amount_paise,
      actualPaise,
      overByPaise: Math.max(0, actualPaise - b.amount_paise),
    };
  });
}
