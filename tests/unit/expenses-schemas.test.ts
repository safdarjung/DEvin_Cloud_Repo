import { describe, expect, it } from "vitest";
import {
  budgetVsActualRows,
  ExpenseBudgetSetSchema,
  ExpenseListSchema,
  ExpenseRecordSchema,
  ExpenseVoidSchema,
  financialYearOf,
  monthKeys,
  rupeesToPaise,
  sumByMonth,
} from "../../src/modules/expenses/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const cat2 = "22222222-2222-4222-8222-222222222222";
const record = (amount: unknown) => ({ categoryId: id, amount, spentOn: "2026-11-02", note: "Diesel for generator" });

describe("rupeesToPaise", () => {
  it("converts strict rupee text to integer paise without float error", () => {
    expect(rupeesToPaise("1500")).toBe(150000);
    expect(rupeesToPaise("1500.5")).toBe(150050);
    expect(rupeesToPaise("1500.05")).toBe(150005);
    expect(rupeesToPaise("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("99999999.99")).toBe(9999999999);
  });
  it("rejects anything that is not plain rupees with up to two decimals", () => {
    for (const bad of ["", "1.234", "-5", "+5", "1e3", "1,500", "01", "1.", ".5", " 5", "abc", "100000000", "NaN", "Infinity"]) {
      expect(rupeesToPaise(bad), bad).toBeNull();
    }
  });
});

describe("ExpenseRecordSchema", () => {
  it("parses rupees to amountPaise and trims text", () => {
    const r = ExpenseRecordSchema.parse({ ...record(" 249.50 "), payee: "  Sharma Fuels ", note: "  Diesel  " });
    expect(r).toEqual({ categoryId: id, amountPaise: 24950, spentOn: "2026-11-02", payee: "Sharma Fuels", note: "Diesel" });
  });
  it("refuses zero, negative, three-decimal and numeric (non-string) amounts", () => {
    for (const bad of ["0", "0.00", "-10", "10.001", 10.5, null]) expect(ExpenseRecordSchema.safeParse(record(bad)).success, String(bad)).toBe(false);
  });
  it("refuses unknown keys, a bad date and an empty note", () => {
    expect(ExpenseRecordSchema.safeParse({ ...record("10"), amountPaise: 1000 }).success).toBe(false);
    expect(ExpenseRecordSchema.safeParse({ ...record("10"), spentOn: "2026-02-30" }).success).toBe(false);
    expect(ExpenseRecordSchema.safeParse({ ...record("10"), note: "   " }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("void reason must be 5-200 characters", () => {
    expect(ExpenseVoidSchema.safeParse({ id, reason: "dup" }).success).toBe(false);
    expect(ExpenseVoidSchema.safeParse({ id, reason: "Entered twice" }).success).toBe(true);
    expect(ExpenseVoidSchema.safeParse({ id, reason: "x".repeat(201) }).success).toBe(false);
  });
  it("budget period must not end before it starts and amount is parsed to paise", () => {
    expect(ExpenseBudgetSetSchema.safeParse({ categoryId: id, periodStart: "2026-04-01", periodEnd: "2026-03-31", amount: "100" }).success).toBe(false);
    const r = ExpenseBudgetSetSchema.parse({ categoryId: id, periodStart: "2026-04-01", periodEnd: "2027-03-31", amount: "50000" });
    expect(r.amountPaise).toBe(5000000);
  });
  it("list filters: from must not be after to; page defaults to 1", () => {
    expect(ExpenseListSchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(ExpenseListSchema.parse({}).page).toBe(1);
  });
});

describe("aggregation helpers", () => {
  it("financial year runs April to March", () => {
    expect(financialYearOf("2026-11-10")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(financialYearOf("2027-02-01")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });
  it("monthKeys lists n months ending at the given month, across a year boundary", () => {
    expect(monthKeys("2026-02-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("sumByMonth nets reversals and zero-fills months, ignoring rows outside the keys", () => {
    const rows = [
      { spent_on: "2026-01-05", amount_paise: 1000, category_id: id },
      { spent_on: "2026-01-05", amount_paise: -1000, category_id: id },
      { spent_on: "2026-02-01", amount_paise: 250, category_id: id },
      { spent_on: "2026-03-01", amount_paise: 999, category_id: id },
    ];
    expect(sumByMonth(["2025-12", "2026-01", "2026-02"], rows)).toEqual([
      { month: "2025-12", totalPaise: 0 },
      { month: "2026-01", totalPaise: 0 },
      { month: "2026-02", totalPaise: 250 },
    ]);
  });
  it("budgetVsActual sums only that category inside the period and flags overspend", () => {
    const budgets = [
      { id: "b1", category_id: id, period_start: "2026-11-01", period_end: "2026-11-30", amount_paise: 1000, expense_categories: { name: "Fuel" } },
      { id: "b2", category_id: cat2, period_start: "2026-11-01", period_end: "2026-11-30", amount_paise: 5000, expense_categories: { name: "Repairs" } },
    ];
    const rows = [
      { category_id: id, spent_on: "2026-11-03", amount_paise: 800 },
      { category_id: id, spent_on: "2026-11-30", amount_paise: 400 },
      { category_id: id, spent_on: "2026-12-01", amount_paise: 9999 },
      { category_id: cat2, spent_on: "2026-11-10", amount_paise: 300 },
      { category_id: cat2, spent_on: "2026-11-10", amount_paise: -300 },
    ];
    expect(budgetVsActualRows(budgets, rows)).toEqual([
      { budgetId: "b1", categoryId: id, categoryName: "Fuel", periodStart: "2026-11-01", periodEnd: "2026-11-30", budgetPaise: 1000, actualPaise: 1200, overByPaise: 200 },
      { budgetId: "b2", categoryId: cat2, categoryName: "Repairs", periodStart: "2026-11-01", periodEnd: "2026-11-30", budgetPaise: 5000, actualPaise: 0, overByPaise: 0 },
    ]);
  });
});
