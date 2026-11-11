import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { Database } from "@/lib/db/types";
import { createCanteenItem, purchaseCanteen, topupCanteen, updateCanteenItem } from "@/modules/canteen/actions";
import { canteenDaySales, canteenStatement } from "@/modules/canteen/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

// Features-18 #10 — canteen (migration 0119). Money rules are the definers':
// canteen_topup / canteen_purchase write the append-only ledger, the balance
// is canteen_balance() only, the purchase price is read from the item.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
let childId: string; // student fixture of `a`, linked to a's guardian
let bStudentId: string;

async function newStudent(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`CNT-${crypto.randomUUID().slice(0, 8)}`}, 'Canteen', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function newItem(inst: TestInstitution, pricePaise: number, isActive = true): Promise<string> {
  const [row] = await sql`
    insert into public.canteen_items (institution_id, name, price_paise, is_active)
    values (${inst.institutionId}, ${`Item ${crypto.randomUUID().slice(0, 8)}`}, ${pricePaise}, ${isActive})
    returning id
  `;
  return row.id as string;
}

function rpcAs(inst: TestInstitution, role: FixtureRole) {
  return inst.clientAs(role) as unknown as SupabaseClient<Database>;
}

async function topup(inst: TestInstitution, studentId: string, amountPaise: number, role: FixtureRole = "accountant") {
  const { error } = await rpcAs(inst, role).rpc("canteen_topup", {
    p_institution_id: inst.institutionId,
    p_student_id: studentId,
    p_amount_paise: amountPaise,
  });
  if (error) throw error;
}

async function ledgerBalance(studentId: string): Promise<number> {
  const [row] = await sql`select coalesce(sum(amount_paise), 0)::int as total from public.canteen_transactions where student_id = ${studentId}`;
  return row.total as number;
}

beforeAll(async () => {
  a = await createTestInstitution("canteen-a");
  b = await createTestInstitution("canteen-b");
  const [{ guardian_id: guardianId }] = await sql`
    select guardian_id from public.memberships where institution_id = ${a.institutionId} and user_id = ${a.users.guardian.id}
  `;
  const [{ student_id: studentId }] = await sql`
    select student_id from public.memberships where institution_id = ${a.institutionId} and user_id = ${a.users.student.id}
  `;
  childId = studentId as string;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${a.institutionId}, ${guardianId}, ${childId}, 'mother', true)
  `;
  bStudentId = await newStudent(b);
}, 60_000);

afterAll(async () => {
  setActingClient(null);
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("canteen (features-18 #10, migration 0119)", () => {
  it("accountant sells through the actions: purchase stored negative, price from the item, balance from canteen_balance", async () => {
    const studentId = await newStudent(a);

    const item = await callAs(a, "accountant", createCanteenItem, { name: "Veg sandwich", pricePaise: 2500 });
    expect(item.ok).toBe(true);
    if (!item.ok) return;

    const top = await callAs(a, "accountant", topupCanteen, { studentId, amountPaise: 10_000, note: "Cash at desk" });
    expect(top.ok && top.data.balancePaise).toBe(10_000);

    const sale = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId: item.data.id, quantity: 2 });
    expect(sale.ok && sale.data.balancePaise).toBe(5_000);
    if (!sale.ok) return;
    const [row] = await sql`select kind, amount_paise, unit_price_paise, quantity from public.canteen_transactions where id = ${sale.data.transactionId}`;
    expect(row).toMatchObject({ kind: "purchase", amount_paise: -5_000, unit_price_paise: 2_500, quantity: 2 });

    // A price change applies to the next sale; the caller can never send one.
    const priced = await callAs(a, "accountant", updateCanteenItem, { id: item.data.id, pricePaise: 3_000 });
    expect(priced.ok).toBe(true);
    const callerPrice = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId: item.data.id, quantity: 1, unitPricePaise: 1 } as never);
    expect(callerPrice.ok).toBe(false);
    if (!callerPrice.ok) expect(callerPrice.error.code).toBe("validation_failed");
    const { error: rpcPriceError } = await rpcAs(a, "accountant").rpc("canteen_purchase", {
      p_institution_id: a.institutionId,
      p_student_id: studentId,
      p_item_id: item.data.id,
      p_quantity: 1,
      p_unit_price_paise: 1,
    } as never);
    expect(rpcPriceError).not.toBeNull();

    const second = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId: item.data.id, quantity: 1 });
    expect(second.ok && second.data.balancePaise).toBe(2_000);
    expect(await ledgerBalance(studentId)).toBe(2_000);

    setActingClient(rpcAs(a, "accountant"));
    const ctx = await buildContext(a, "accountant");
    const statement = await canteenStatement(ctx, studentId);
    expect(statement.balancePaise).toBe(2_000);
    expect(statement.transactions.map((t) => t.amountPaise)).toEqual([-3_000, -5_000, 10_000]);
    expect(statement.transactions[0]!.itemName).toBe("Veg sandwich");

    const sales = await canteenDaySales(ctx, {});
    const line = sales.byItem.find((i) => i.itemId === item.data.id);
    expect(line).toMatchObject({ quantity: 3, amountPaise: 8_000 });
    expect(sales.salesPaise).toBeGreaterThanOrEqual(8_000);
    setActingClient(null);

    const deactivated = await callAs(a, "accountant", updateCanteenItem, { id: item.data.id, isActive: false });
    expect(deactivated.ok).toBe(true);
    const offSale = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId: item.data.id, quantity: 1 });
    expect(!offSale.ok && offSale.error.code).toBe("invalid_state");
  });

  it("refuses an overdraft and leaves the balance unchanged", async () => {
    const studentId = await newStudent(a);
    const itemId = await newItem(a, 300);
    await topup(a, studentId, 500);

    const res = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId, quantity: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid_state");
    expect(await ledgerBalance(studentId)).toBe(500);

    const { data, error } = await rpcAs(a, "admin").rpc("canteen_balance", { p_institution_id: a.institutionId, p_student_id: studentId });
    expect(error).toBeNull();
    expect(data).toBe(500);
  });

  it("two parallel purchases cannot overdraw: exactly one succeeds", async () => {
    for (let round = 0; round < 3; round++) {
      const studentId = await newStudent(a);
      const itemId = await newItem(a, 300);
      await topup(a, studentId, 500);

      const args = { p_institution_id: a.institutionId, p_student_id: studentId, p_item_id: itemId, p_quantity: 1 };
      const results = await Promise.all([
        rpcAs(a, "accountant").rpc("canteen_purchase", args),
        rpcAs(a, "admin").rpc("canteen_purchase", args),
      ]);
      const failures = results.filter((r) => r.error);
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.error!.message).toBe("code:invalid_state");
      expect(await ledgerBalance(studentId)).toBe(200);
    }
  });

  it("guardian and student read only their own child's balance and history; they cannot top up", async () => {
    const otherId = await newStudent(a);
    await topup(a, childId, 1_000);
    await topup(a, otherId, 2_000);

    for (const role of ["guardian", "student"] as const) {
      const client = rpcAs(a, role);
      const { data, error } = await client.from("canteen_transactions").select("student_id");
      expect(error).toBeNull();
      expect(new Set(data?.map((r) => r.student_id))).toEqual(new Set([childId]));

      const own = await client.rpc("canteen_balance", { p_institution_id: a.institutionId, p_student_id: childId });
      expect(own.data).toBe(await ledgerBalance(childId));
      const other = await client.rpc("canteen_balance", { p_institution_id: a.institutionId, p_student_id: otherId });
      expect(other.data).toBe(0);

      const { error: topupError } = await client.rpc("canteen_topup", { p_institution_id: a.institutionId, p_student_id: childId, p_amount_paise: 500 });
      expect(topupError?.message).toBe("code:forbidden");
    }

    setActingClient(rpcAs(a, "guardian"));
    const statement = await canteenStatement(await buildContext(a, "guardian"), otherId);
    expect(statement).toEqual({ balancePaise: 0, transactions: [] });
    setActingClient(null);
  });

  it("teacher is denied: no ledger rows, no top-up, no purchase, no menu edits", async () => {
    const studentId = await newStudent(a);
    const itemId = await newItem(a, 300);
    await topup(a, studentId, 1_000);
    const teacher = rpcAs(a, "teacher");

    const { data } = await teacher.from("canteen_transactions").select("id");
    expect(data).toEqual([]);
    const balance = await teacher.rpc("canteen_balance", { p_institution_id: a.institutionId, p_student_id: studentId });
    expect(balance.data).toBe(0);

    const t = await teacher.rpc("canteen_topup", { p_institution_id: a.institutionId, p_student_id: studentId, p_amount_paise: 500 });
    expect(t.error?.message).toBe("code:forbidden");
    const p = await teacher.rpc("canteen_purchase", { p_institution_id: a.institutionId, p_student_id: studentId, p_item_id: itemId, p_quantity: 1 });
    expect(p.error?.message).toBe("code:forbidden");
    const ins = await teacher.from("canteen_items").insert({ institution_id: a.institutionId, name: "Teacher item", price_paise: 100 });
    expect(ins.error).not.toBeNull();

    const viaAction = await callAs(a, "teacher", topupCanteen, { studentId, amountPaise: 500 });
    expect(!viaAction.ok && viaAction.error.code).toBe("forbidden");
    expect(await ledgerBalance(studentId)).toBe(1_000);
  });

  it("cross-tenant: another school's institution, student and item are refused", async () => {
    const studentId = await newStudent(a);
    const bItemId = await newItem(b, 100);
    await topup(b, bStudentId, 1_000);
    const accountantA = rpcAs(a, "accountant");

    const wrongInst = await accountantA.rpc("canteen_topup", { p_institution_id: b.institutionId, p_student_id: bStudentId, p_amount_paise: 500 });
    expect(wrongInst.error?.message).toBe("code:forbidden");
    const wrongStudent = await accountantA.rpc("canteen_topup", { p_institution_id: a.institutionId, p_student_id: bStudentId, p_amount_paise: 500 });
    expect(wrongStudent.error?.message).toBe("code:not_found");

    await topup(a, studentId, 1_000);
    const wrongItem = await callAs(a, "accountant", purchaseCanteen, { studentId, itemId: bItemId, quantity: 1 });
    expect(!wrongItem.ok && wrongItem.error.code).toBe("not_found");

    const { data } = await accountantA.from("canteen_transactions").select("id").eq("institution_id", b.institutionId);
    expect(data).toEqual([]);
    const bBalance = await accountantA.rpc("canteen_balance", { p_institution_id: b.institutionId, p_student_id: bStudentId });
    expect(bBalance.data).toBe(0);
    expect(await ledgerBalance(bStudentId)).toBe(1_000);
  });

  it("ledger is append-only for API roles", async () => {
    const studentId = await newStudent(a);
    await topup(a, studentId, 1_000);
    const accountant = rpcAs(a, "accountant");

    const ins = await accountant.from("canteen_transactions").insert({
      institution_id: a.institutionId,
      student_id: studentId,
      kind: "topup",
      amount_paise: 100_000,
      recorded_by: a.users.accountant.id,
    });
    expect(ins.error).not.toBeNull();
    const upd = await accountant.from("canteen_transactions").update({ amount_paise: 999_999 }).eq("student_id", studentId);
    expect(upd.error).not.toBeNull();
    const del = await accountant.from("canteen_transactions").delete().eq("student_id", studentId);
    expect(del.error).not.toBeNull();
    expect(await ledgerBalance(studentId)).toBe(1_000);
  });
});
