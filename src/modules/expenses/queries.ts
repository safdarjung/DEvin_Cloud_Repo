import "server-only";
// Features-18 #8 — expenses.* reads. Signed-in user's RLS client (expense
// tables are finance_roles() only, 0117); institution_id filters are defense
// in depth. Totals: 0117 ships no SQL aggregate and PostgREST aggregates are
// off, so every total sums a keyset-paged read (order by id, id > last) that
// stops only on an empty page — PostgREST's max_rows (1000) can never
// truncate it (DBT-40), and a concurrent insert cannot double-count a row.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { ilikeTerm, LIST_PAGE_SIZE, pageRange, type PageResult } from "@/lib/list-search";
import {
  budgetVsActualRows,
  financialYearOf,
  monthKeys,
  sumByMonth,
  type AmountRow,
  type BudgetVsActualRow,
  type ExpenseFilters,
  type ExpenseListInput,
} from "./schemas";

const KEYSET_PAGE = 1000;
const BUDGET_LIMIT = 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Today's date (YYYY-MM-DD) in India; spent_on is a plain date. */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** Every expense row (originals and reversals) matching the filters, all pages. */
async function readAmounts(supabase: Supabase, institutionId: string, f: ExpenseFilters): Promise<AmountRow[]> {
  const out: AmountRow[] = [];
  let lastId: string | null = null;
  for (;;) {
    let q = supabase.from("expenses").select("id, category_id, spent_on, amount_paise").eq("institution_id", institutionId);
    if (f.categoryId) q = q.eq("category_id", f.categoryId);
    if (f.from) q = q.gte("spent_on", f.from);
    if (f.to) q = q.lte("spent_on", f.to);
    if (f.q) q = q.or(`description.ilike.${ilikeTerm(f.q)},payee.ilike.${ilikeTerm(f.q)}`);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q.order("id").limit(KEYSET_PAGE);
    if (error) throw error;
    if (!data || data.length === 0) return out;
    for (const r of data) out.push({ category_id: r.category_id, spent_on: r.spent_on, amount_paise: r.amount_paise });
    lastId = data[data.length - 1]!.id;
  }
}

export interface ExpenseRow {
  id: string;
  categoryId: string;
  categoryName: string;
  amountPaise: number;
  spentOn: string;
  description: string;
  payee: string | null;
  /** Set on a reversing row: the expense it voids. */
  reversesExpenseId: string | null;
  /** True for an original that has a reversing row. */
  isVoided: boolean;
  createdAt: string;
}

/** One page of the register, newest first. Reversing rows are listed too (negative amount). */
export async function expensesList(ctx: TenantContext, f: ExpenseListInput): Promise<PageResult<ExpenseRow>> {
  const supabase = await createClient();
  let q = supabase
    .from("expenses")
    .select("id, category_id, amount_paise, spent_on, description, payee, reverses_expense_id, created_at, expense_categories(name)", { count: "exact" })
    .eq("institution_id", ctx.institution.id);
  if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.from) q = q.gte("spent_on", f.from);
  if (f.to) q = q.lte("spent_on", f.to);
  if (f.q) q = q.or(`description.ilike.${ilikeTerm(f.q)},payee.ilike.${ilikeTerm(f.q)}`);
  const [from, to] = pageRange(f.page);
  const { data, error, count } = await q.order("spent_on", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;
  const rows = data ?? [];

  const originalIds = rows.filter((r) => !r.reverses_expense_id).map((r) => r.id);
  const voided = new Set<string>();
  if (originalIds.length > 0) {
    const { data: rev, error: revError } = await supabase
      .from("expenses")
      .select("reverses_expense_id")
      .eq("institution_id", ctx.institution.id)
      .in("reverses_expense_id", originalIds);
    if (revError) throw revError;
    for (const r of rev ?? []) if (r.reverses_expense_id) voided.add(r.reverses_expense_id);
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      categoryName: r.expense_categories?.name ?? "",
      amountPaise: r.amount_paise,
      spentOn: r.spent_on,
      description: r.description,
      payee: r.payee,
      reversesExpenseId: r.reverses_expense_id,
      isVoided: voided.has(r.id),
      createdAt: r.created_at,
    })),
    total: count ?? 0,
    page: f.page,
    pageSize: LIST_PAGE_SIZE,
  };
}

/** Net total (reversals included) and row count for the same filters as the list, summed over every page. */
export async function expensesTotal(ctx: TenantContext, f: ExpenseFilters): Promise<{ totalPaise: number; rows: number }> {
  const rows = await readAmounts(await createClient(), ctx.institution.id, f);
  return { totalPaise: rows.reduce((s, r) => s + r.amount_paise, 0), rows: rows.length };
}

export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
}

export async function expenseCategories(ctx: TenantContext): Promise<ExpenseCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, is_active")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, isActive: c.is_active }));
}

/** Name-free aggregate: net spend per month for the last `months` months (India time), zero-filled. */
export async function expensesMonthlyTotals(ctx: TenantContext, months: number): Promise<{ month: string; totalPaise: number }[]> {
  const keys = monthKeys(todayIst(), months);
  const rows = await readAmounts(await createClient(), ctx.institution.id, { from: `${keys[0]}-01` });
  return sumByMonth(keys, rows);
}

/**
 * Name-free aggregate: each budget overlapping [from, to] (default: the
 * current financial year) with the net spend of its category inside the
 * budget's own period.
 */
export async function expensesBudgetVsActual(ctx: TenantContext, input: { from?: string; to?: string }): Promise<{ from: string; to: string; rows: BudgetVsActualRow[] }> {
  const fy = financialYearOf(todayIst());
  const window = { from: input.from ?? fy.from, to: input.to ?? fy.to };
  const supabase = await createClient();
  // shortcut: budgets read capped at 1000 rows (one per category+period); page it if a school ever exceeds that.
  const { data: budgets, error } = await supabase
    .from("budgets")
    .select("id, category_id, period_start, period_end, amount_paise, expense_categories(name)")
    .eq("institution_id", ctx.institution.id)
    .lte("period_start", window.to)
    .gte("period_end", window.from)
    .order("period_start")
    .order("id")
    .limit(BUDGET_LIMIT);
  if (error) throw error;
  if (!budgets || budgets.length === 0) return { ...window, rows: [] };

  const from = budgets.reduce((m, b) => (b.period_start < m ? b.period_start : m), budgets[0]!.period_start);
  const to = budgets.reduce((m, b) => (b.period_end > m ? b.period_end : m), budgets[0]!.period_end);
  const rows = await readAmounts(supabase, ctx.institution.id, { from, to });
  return { ...window, rows: budgetVsActualRows(budgets, rows).sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.periodStart.localeCompare(b.periodStart)) };
}
