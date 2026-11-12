// Curveball sweep (expenses): rupee-text edges, parallel double void, budget period order, unknown ids.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createExpenseCategory, recordExpense, setExpenseBudget, updateExpenseCategory, voidExpense } from "@/modules/expenses/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let categoryId: string;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

beforeAll(async () => {
  inst = await createTestInstitution("exp-cb");
  const r = await callAs(inst, "accountant", createExpenseCategory, { name: "Stationery" });
  if (!r.ok) throw new Error("fixture category failed");
  categoryId = r.data.id;
});

afterAll(async () => {
  await inst.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const rec = (amount: unknown) => ({ categoryId, amount, spentOn: today, note: "Chalk" });

describe("expenses curveballs", () => {
  it.each([["0"], ["0.00"], ["-5"], ["10.001"], ["1e3"], ["01"], ["1,500"], ["₹100"], [""], [1500]])(
    "amount %j → validation_failed on amount, nothing written",
    async (amount) => {
      const [before] = await sql`select count(*)::int as n from public.expenses where category_id = ${categoryId}`;
      const r = await callAs(inst, "accountant", recordExpense, rec(amount));
      expect(r.ok ? null : r.error.code).toBe("validation_failed");
      expect(r.ok ? null : r.error.fieldErrors?.amount).toBeTruthy();
      const [after] = await sql`select count(*)::int as n from public.expenses where category_id = ${categoryId}`;
      expect(after.n).toBe(before.n);
    },
  );

  it("'0.1' + '0.2' + '9999999.70' sum to exactly 1000000000 paise", async () => {
    const cat = await callAs(inst, "accountant", createExpenseCategory, { name: "Drift" });
    if (!cat.ok) throw new Error(cat.error.code);
    for (const amount of ["0.1", "0.2", "9999999.70"]) {
      const r = await callAs(inst, "accountant", recordExpense, { categoryId: cat.data.id, amount, spentOn: today, note: "x" });
      expect(r.ok).toBe(true);
    }
    const [s] = await sql`select sum(amount_paise)::text as s from public.expenses where category_id = ${cat.data.id}`;
    expect(s.s).toBe("1000000000");
  });

  it("two parallel voids of one expense: exactly one reversal row", async () => {
    const r = await callAs(inst, "accountant", recordExpense, rec("250"));
    if (!r.ok) throw new Error(r.error.code);
    const rs = await Promise.all([
      callAs(inst, "accountant", voidExpense, { id: r.data.id, reason: "Duplicate entry" }),
      callAs(inst, "admin", voidExpense, { id: r.data.id, reason: "Duplicate entry" }),
    ]);
    expect(rs.filter((x) => x.ok)).toHaveLength(1);
    const [c] = await sql`select count(*)::int as n from public.expenses where reverses_expense_id = ${r.data.id}`;
    expect(c.n).toBe(1);
  });

  it("void of an unknown id → not_found; short reason → validation_failed on reason", async () => {
    const unknown = await callAs(inst, "accountant", voidExpense, { id: crypto.randomUUID(), reason: "Wrong entry" });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const short = await callAs(inst, "accountant", voidExpense, { id: crypto.randomUUID(), reason: "no" });
    expect(short.ok ? null : short.error.fieldErrors?.reason).toBeTruthy();
  });

  it("budget with end before start → validation_failed on periodEnd; unknown category → not_found", async () => {
    const back = await callAs(inst, "accountant", setExpenseBudget, { categoryId, periodStart: "2026-12-01", periodEnd: "2026-11-30", amount: "100" });
    expect(back.ok ? null : back.error.fieldErrors?.periodEnd).toBeTruthy();
    const unknown = await callAs(inst, "accountant", setExpenseBudget, { categoryId: crypto.randomUUID(), periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: "100" });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
  });

  it("update of an unknown category → not_found", async () => {
    const r = await callAs(inst, "accountant", updateExpenseCategory, { id: crypto.randomUUID(), name: "Ghost", isActive: true });
    expect(r.ok ? null : r.error.code).toBe("not_found");
  });
});
