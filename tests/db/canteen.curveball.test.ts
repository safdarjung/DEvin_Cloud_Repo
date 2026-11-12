// Curveball sweep (canteen): paise validation edges, inactive item, price change vs history, parallel top-ups sum exactly.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createCanteenItem, purchaseCanteen, topupCanteen, updateCanteenItem } from "@/modules/canteen/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let b: TestInstitution;

async function newStudent(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`CCB-${crypto.randomUUID().slice(0, 8)}`}, 'Canteen', '2015-01-01', 'other') returning id
  `;
  return row.id as string;
}
async function newItem(inst: TestInstitution, pricePaise: number, isActive = true): Promise<string> {
  const [row] = await sql`
    insert into public.canteen_items (institution_id, name, price_paise, is_active)
    values (${inst.institutionId}, ${`Item ${crypto.randomUUID().slice(0, 8)}`}, ${pricePaise}, ${isActive}) returning id
  `;
  return row.id as string;
}
async function balance(studentId: string): Promise<number> {
  const [row] = await sql`select coalesce(sum(amount_paise), 0)::bigint as t from public.canteen_transactions where student_id = ${studentId}`;
  return Number(row.t);
}

beforeAll(async () => {
  a = await createTestInstitution("canteen-cb");
  b = await createTestInstitution("canteen-cb-x");
}, 60_000);

afterAll(async () => {
  setActingClient(null);
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("canteen curveballs", () => {
  it.each([
    ["below minimum (99 paise)", 99],
    ["zero", 0],
    ["negative", -500],
    ["fractional paise", 150.5],
    ["above maximum", 1_000_001],
  ])("top-up %s → validation_failed on amountPaise, ledger untouched", async (_l, amountPaise) => {
    const sid = await newStudent(a);
    const r = await callAs(a, "accountant", topupCanteen, { studentId: sid, amountPaise });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.amountPaise).toBeTruthy();
    expect(await balance(sid)).toBe(0);
  });

  it.each([
    ["zero", 0],
    ["21", 21],
    ["fractional", 1.5],
  ])("purchase quantity %s → validation_failed on quantity", async (_l, quantity) => {
    const r = await callAs(a, "accountant", purchaseCanteen, { studentId: await newStudent(a), itemId: await newItem(a, 100), quantity });
    expect(r.ok ? null : r.error.fieldErrors?.quantity).toBeTruthy();
  });

  it("an inactive item cannot be sold, and the balance is untouched", async () => {
    const sid = await newStudent(a);
    const t = await callAs(a, "accountant", topupCanteen, { studentId: sid, amountPaise: 5000 });
    expect(t.ok).toBe(true);
    const r = await callAs(a, "accountant", purchaseCanteen, { studentId: sid, itemId: await newItem(a, 100, false), quantity: 1 });
    expect(r.ok).toBe(false);
    expect(await balance(sid)).toBe(5000);
  });

  it("a later price change never rewrites past purchases", async () => {
    const sid = await newStudent(a);
    const itemId = await newItem(a, 1500);
    await callAs(a, "accountant", topupCanteen, { studentId: sid, amountPaise: 10_000 });
    const p = await callAs(a, "accountant", purchaseCanteen, { studentId: sid, itemId, quantity: 2 });
    expect(p.ok).toBe(true);
    const u = await callAs(a, "admin", updateCanteenItem, { id: itemId, pricePaise: 9999 });
    expect(u.ok).toBe(true);
    expect(await balance(sid)).toBe(7000);
  });

  it("ten parallel top-ups of 1234 paise sum to exactly 12340", async () => {
    const sid = await newStudent(a);
    const rs = await Promise.all(Array.from({ length: 10 }, () => callAs(a, "accountant", topupCanteen, { studentId: sid, amountPaise: 1234 })));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await balance(sid)).toBe(12_340);
  });

  it("an empty update → validation_failed; another school's item → not_found; price 0 → validation_failed", async () => {
    const own = await newItem(a, 100);
    const empty = await callAs(a, "accountant", updateCanteenItem, { id: own });
    expect(empty.ok ? null : empty.error.code).toBe("validation_failed");
    const foreign = await callAs(a, "accountant", updateCanteenItem, { id: await newItem(b, 100), pricePaise: 1 });
    expect(foreign.ok ? null : foreign.error.code).toBe("not_found");
    const zero = await callAs(a, "accountant", createCanteenItem, { name: "Free", pricePaise: 0 });
    expect(zero.ok ? null : zero.error.fieldErrors?.pricePaise).toBeTruthy();
  });

  it("top-up for another school's student is refused and writes nothing", async () => {
    const foreign = await newStudent(b);
    const r = await callAs(a, "accountant", topupCanteen, { studentId: foreign, amountPaise: 500 });
    expect(r.ok).toBe(false);
    expect(await balance(foreign)).toBe(0);
  });
});
