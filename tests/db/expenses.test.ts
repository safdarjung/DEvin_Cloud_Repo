// Features-18 #8 — expenses: append-only register, void_expense reversal rule, RLS, actions, paged totals.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createExpenseCategory, recordExpense, setExpenseBudget, updateExpenseCategory, voidExpense } from "@/modules/expenses/actions";
import { expensesBudgetVsActualQuery, expensesListQuery, expensesMonthlyTotalsQuery } from "@/modules/expenses/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let other: TestInstitution;
let categoryId: string;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

beforeAll(async () => {
  inst = await createTestInstitution("exp");
  other = await createTestInstitution("exp-x");
  const r = await callAs(inst, "accountant", createExpenseCategory, { name: "Fuel" });
  if (!r.ok) throw new Error("fixture category failed");
  categoryId = r.data.id;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const rec = (amount: string, note = "Diesel") => ({ categoryId, amount, spentOn: today, payee: "Sharma Fuels", note });
async function recordAs(role: "owner" | "principal" | "admin" | "accountant", amount: string): Promise<string> {
  const r = await callAs(inst, role, recordExpense, rec(amount));
  if (!r.ok) throw new Error(`record as ${role} failed: ${r.error.code}`);
  return r.data.id;
}
async function netForCategory(): Promise<number> {
  const [s] = await sql`select coalesce(sum(amount_paise), 0)::bigint as n from public.expenses where category_id = ${categoryId}`;
  return Number(s!.n);
}

describe("expenses", () => {
  it("every expense.manage role records; amount is stored as integer paise with recorded_by = caller", async () => {
    for (const role of ["owner", "principal", "admin", "accountant"] as const) {
      const id = await recordAs(role, "100.25");
      const [row] = await sql`select amount_paise, recorded_by from public.expenses where id = ${id}`;
      expect(Number(row!.amount_paise)).toBe(10025);
      expect(row!.recorded_by).toBe(inst.users[role].id);
    }
  });

  it("void inserts a reversing row and the net total returns to zero", async () => {
    const before = await netForCategory();
    const id = await recordAs("accountant", "999.99");
    expect(await netForCategory()).toBe(before + 99999);
    const v = await callAs(inst, "principal", voidExpense, { id, reason: "Entered twice" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const [rev] = await sql`select amount_paise, reverses_expense_id, description from public.expenses where id = ${v.data.voidId}`;
    expect(Number(rev!.amount_paise)).toBe(-99999);
    expect(rev!.reverses_expense_id).toBe(id);
    expect(rev!.description).toBe("Entered twice");
    expect(await netForCategory()).toBe(before);

    const list = await callAs(inst, "accountant", expensesListQuery, { categoryId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.rows.find((r) => r.id === id)!.isVoided).toBe(true);
    expect(list.data.rows.find((r) => r.id === v.data.voidId)!.reversesExpenseId).toBe(id);
  });

  it("a second void and voiding a reversing row are both refused", async () => {
    const id = await recordAs("admin", "50");
    const first = await callAs(inst, "admin", voidExpense, { id, reason: "Wrong category" });
    expect(first.ok).toBe(true);
    const again = await callAs(inst, "owner", voidExpense, { id, reason: "Wrong category" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("conflict");
    if (!first.ok) return;
    const rev = await callAs(inst, "owner", voidExpense, { id: first.data.voidId, reason: "Undo the void" });
    expect(rev.ok).toBe(false);
    if (!rev.ok) expect(rev.error.code).toBe("invalid_state");
    const [n] = await sql`select count(*)::int as n from public.expenses where reverses_expense_id = ${id}`;
    expect(n!.n).toBe(1);
  });

  it("void by a role without expense.manage is refused at the action and at the rpc", async () => {
    const id = await recordAs("accountant", "75");
    for (const role of ["teacher", "admissions", "exam_controller"] as const) {
      const r = await callAs(inst, role, voidExpense, { id, reason: "Not allowed" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("forbidden");
      const rpc = await inst.clientAs(role).rpc("void_expense", { p_expense_id: id, p_reason: "Not allowed" });
      expect(rpc.error?.message).toBe("code:forbidden");
    }
    const [n] = await sql`select count(*)::int as n from public.expenses where reverses_expense_id = ${id}`;
    expect(n!.n).toBe(0);
  });

  it("expenses cannot be updated or deleted, by API roles or directly", async () => {
    const id = await recordAs("accountant", "10");
    const owner = inst.clientAs("owner");
    const upd = await owner.from("expenses").update({ amount_paise: 1 }).eq("id", id).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await owner.from("expenses").delete().eq("id", id).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    await expect(sql`update public.expenses set amount_paise = 1 where id = ${id}`).rejects.toThrow(/code:invalid_state/);
    await expect(sql`delete from public.expenses where id = ${id}`).rejects.toThrow(/code:invalid_state/);
    const [row] = await sql`select amount_paise from public.expenses where id = ${id}`;
    expect(Number(row!.amount_paise)).toBe(1000);
  });

  it("direct inserts cannot forge recorded_by, a negative amount or a reversal", async () => {
    const acct = inst.clientAs("accountant");
    const base = { institution_id: inst.institutionId, category_id: categoryId, spent_on: today, description: "Probe" };
    const forged = await acct.from("expenses").insert({ ...base, amount_paise: 100, recorded_by: inst.users.owner.id });
    expect(forged.error).not.toBeNull();
    const negative = await acct.from("expenses").insert({ ...base, amount_paise: -100, recorded_by: inst.users.accountant.id });
    expect(negative.error).not.toBeNull();
    const id = await recordAs("accountant", "20");
    const fakeVoid = await acct.from("expenses").insert({ ...base, amount_paise: -2000, reverses_expense_id: id, recorded_by: inst.users.accountant.id });
    expect(fakeVoid.error).not.toBeNull();
  });

  it("teacher is denied: no rows, no queries, no actions", async () => {
    const t = inst.clientAs("teacher");
    for (const table of ["expenses", "expense_categories", "budgets"] as const) {
      const { data } = await t.from(table).select("id");
      expect(data ?? []).toHaveLength(0);
    }
    const list = await callAs(inst, "teacher", expensesListQuery, {});
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe("forbidden");
    expect((await callAs(inst, "teacher", recordExpense, rec("5"))).ok).toBe(false);
    expect((await callAs(inst, "teacher", createExpenseCategory, { name: "Nope" })).ok).toBe(false);
  });

  it("cross-tenant is refused: reads, record, void, budget", async () => {
    const id = await recordAs("accountant", "30");
    const x = other.clientAs("admin");
    const { data } = await x.from("expenses").select("id").eq("institution_id", inst.institutionId);
    expect(data ?? []).toHaveLength(0);
    const r = await callAs(other, "admin", recordExpense, rec("5"));
    expect(r.ok).toBe(false);
    const v = await callAs(other, "admin", voidExpense, { id, reason: "Cross tenant" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("not_found");
    const rpc = await x.rpc("void_expense", { p_expense_id: id, p_reason: "Cross tenant" });
    expect(rpc.error?.message).toBe("code:not_found");
    const b = await callAs(other, "admin", setExpenseBudget, { categoryId, periodStart: "2026-04-01", periodEnd: "2027-03-31", amount: "1" });
    expect(b.ok).toBe(false);
  });

  it("an inactive category refuses new expenses; duplicate names conflict", async () => {
    const c = await callAs(inst, "admin", createExpenseCategory, { name: "Old stationery" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect((await callAs(inst, "admin", updateExpenseCategory, { id: c.data.id, name: "Old stationery", isActive: false })).ok).toBe(true);
    const r = await callAs(inst, "admin", recordExpense, { ...rec("5"), categoryId: c.data.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_state");
    const dup = await callAs(inst, "admin", createExpenseCategory, { name: "Fuel" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("conflict");
  });

  it("budget set replaces the amount; budget vs actual and monthly totals sum past max_rows (1000)", async () => {
    const c = await callAs(inst, "accountant", createExpenseCategory, { name: "Bulk" });
    if (!c.ok) throw new Error("category failed");
    const bulk = c.data.id;
    await sql`
      insert into public.expenses (institution_id, category_id, amount_paise, spent_on, description, recorded_by)
      select ${inst.institutionId}, ${bulk}, 100, ${today}::date, 'Bulk row', ${inst.users.accountant.id}
      from generate_series(1, 1005)
    `;
    const period = { categoryId: bulk, periodStart: `${today.slice(0, 7)}-01`, periodEnd: today };
    const b1 = await callAs(inst, "accountant", setExpenseBudget, { ...period, amount: "500" });
    const b2 = await callAs(inst, "accountant", setExpenseBudget, { ...period, amount: "1000.50" });
    expect(b1.ok && b2.ok).toBe(true);
    if (!b1.ok || !b2.ok) return;
    expect(b2.data).toEqual({ id: b1.data.id, created: false });

    const bva = await callAs(inst, "principal", expensesBudgetVsActualQuery, { from: period.periodStart, to: today });
    expect(bva.ok).toBe(true);
    if (!bva.ok) return;
    const row = bva.data.rows.find((r) => r.categoryId === bulk)!;
    expect(row).toMatchObject({ budgetPaise: 100050, actualPaise: 100500, overByPaise: 450 });

    const monthly = await callAs(inst, "owner", expensesMonthlyTotalsQuery, { months: 1 });
    expect(monthly.ok).toBe(true);
    if (!monthly.ok) return;
    const [s] = await sql`select coalesce(sum(amount_paise), 0)::bigint as n from public.expenses where institution_id = ${inst.institutionId} and spent_on >= ${`${today.slice(0, 7)}-01`}::date`;
    expect(monthly.data).toEqual([{ month: today.slice(0, 7), totalPaise: Number(s!.n) }]);
  });
});
