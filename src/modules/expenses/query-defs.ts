// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/expenses.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { ExpenseBudgetVsActualSchema, ExpenseEmptySchema, ExpenseListSchema, ExpenseMonthlyTotalsSchema } from "./schemas";
import { expenseCategories, expensesBudgetVsActual, expensesList, expensesMonthlyTotals } from "./queries";

/** One page of the expense register (description, payee, amount, voided flag); filters: category, date range, text. */
export const expensesListQuery = defineQuery({
  name: "expenses.list",
  module: "expenses",
  schema: ExpenseListSchema,
  permission: "expense.read",
  handler: (input, ctx) => expensesList(ctx, input),
});

/** Every expense category with its active flag. */
export const expensesCategoriesQuery = defineQuery({
  name: "expenses.categories",
  module: "expenses",
  schema: ExpenseEmptySchema,
  permission: "expense.read",
  handler: (_input, ctx) => expenseCategories(ctx),
});

/** Name-free aggregate: net expense total per month (paise) for the last N months. */
export const expensesMonthlyTotalsQuery = defineQuery({
  name: "expenses.monthlyTotals",
  module: "expenses",
  schema: ExpenseMonthlyTotalsSchema,
  permission: "expense.read",
  handler: (input, ctx) => expensesMonthlyTotals(ctx, input.months),
});

/** Name-free aggregate: budget vs actual spend (paise) per category and budget period. */
export const expensesBudgetVsActualQuery = defineQuery({
  name: "expenses.budgetVsActual",
  module: "expenses",
  schema: ExpenseBudgetVsActualSchema,
  permission: "expense.read",
  handler: (input, ctx) => expensesBudgetVsActual(ctx, input),
});
