"use server";

// Features-18 #8 — expenses actions (migration 0117). Expenses are
// append-only: a correction is public.void_expense (reversing row + audit in
// SQL), never an update. Categories and budgets are plain RLS writes audited
// here. Free text (note, payee, reason, names) never goes into audit.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ExpenseBudgetSetSchema,
  ExpenseCategoryCreateSchema,
  ExpenseCategoryUpdateSchema,
  ExpenseRecordSchema,
  ExpenseVoidSchema,
} from "@/modules/expenses/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function throwCategoryError(error: { code?: string }): never {
  if (error.code === POSTGRES_UNIQUE_VIOLATION) throw new AppError("conflict", "A category with this name already exists.");
  throwMapped(error);
}

export const recordExpense = defineAction({
  name: "expenses.record",
  module: "expenses",
  schema: ExpenseRecordSchema,
  permission: "expense.manage",
  handler: async ({ categoryId, amountPaise, spentOn, payee, note }, ctx) => {
    const supabase = await createClient();
    const { data: category, error: categoryError } = await supabase
      .from("expense_categories")
      .select("is_active")
      .eq("id", categoryId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (categoryError) throwMapped(categoryError);
    if (!category) throw new AppError("not_found", "Category not found.");
    if (!category.is_active) throw new AppError("invalid_state", "This category is inactive. Reactivate it or pick another.");

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        institution_id: ctx.institution.id,
        category_id: categoryId,
        amount_paise: amountPaise,
        spent_on: spentOn,
        description: note,
        payee: payee ?? null,
        recorded_by: ctx.user.id, // RLS requires the caller
      })
      .select("id")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, { action: "expenses.record", entityType: "expenses", entityId: data.id, after: { amount_paise: amountPaise, category_id: categoryId } });
    return { id: data.id as string };
  },
});

export const voidExpense = defineAction({
  name: "expenses.void",
  module: "expenses",
  schema: ExpenseVoidSchema,
  permission: "expense.manage",
  handler: async ({ id, reason }, ctx) => {
    const supabase = await createClient();
    // The definer resolves the institution from the row; pin it to this route's school first (rule 1).
    const { data: row, error: rowError } = await supabase.from("expenses").select("id").eq("id", id).eq("institution_id", ctx.institution.id).maybeSingle();
    if (rowError) throwMapped(rowError);
    if (!row) throw new AppError("not_found", "Expense not found.");

    const { data, error } = await supabase.rpc("void_expense", { p_expense_id: id, p_reason: reason });
    if (error) throwMapped(error);
    const result = data as { void_id: string; expense_id: string };
    return { voidId: result.void_id, expenseId: result.expense_id };
  },
});

export const createExpenseCategory = defineAction({
  name: "expenses.category.create",
  module: "expenses",
  schema: ExpenseCategoryCreateSchema,
  permission: "expense.manage",
  handler: async ({ name }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_categories").insert({ institution_id: ctx.institution.id, name }).select("id").single();
    if (error) throwCategoryError(error);
    await audit(ctx, { action: "expenses.category.create", entityType: "expense_categories", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateExpenseCategory = defineAction({
  name: "expenses.category.update",
  module: "expenses",
  schema: ExpenseCategoryUpdateSchema,
  permission: "expense.manage",
  handler: async ({ id, name, isActive }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("expense_categories")
      .update({ name, is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwCategoryError(error);
    if (!data) throw new AppError("not_found", "Category not found.");
    await audit(ctx, { action: "expenses.category.update", entityType: "expense_categories", entityId: data.id, after: { is_active: isActive } });
    return { id: data.id as string };
  },
});

/** Creates the budget for (category, period) or replaces its amount when one exists. */
export const setExpenseBudget = defineAction({
  name: "expenses.budget.set",
  module: "expenses",
  schema: ExpenseBudgetSetSchema,
  permission: "expense.manage",
  handler: async ({ categoryId, periodStart, periodEnd, amountPaise }, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: findError } = await supabase
      .from("budgets")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("category_id", categoryId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    if (findError) throwMapped(findError);

    // Only amount_paise is updatable (0117 column grant), so no upsert.
    const { data, error } = existing
      ? await supabase.from("budgets").update({ amount_paise: amountPaise }).eq("id", existing.id).eq("institution_id", ctx.institution.id).select("id").single()
      : await supabase
          .from("budgets")
          .insert({ institution_id: ctx.institution.id, category_id: categoryId, period_start: periodStart, period_end: periodEnd, amount_paise: amountPaise })
          .select("id")
          .single();
    if (error) throwMapped(error);

    await audit(ctx, {
      action: "expenses.budget.set",
      entityType: "budgets",
      entityId: data.id,
      after: { category_id: categoryId, period_start: periodStart, period_end: periodEnd, amount_paise: amountPaise },
    });
    return { id: data.id as string, created: !existing };
  },
});
