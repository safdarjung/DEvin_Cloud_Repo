// Curveball sweep (fee-plans): instalment/late-fee validation edges, decimal splits, role denials, part-paid invoice.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setInstalments, upsertLateFeeRule } from "@/modules/fee-plans/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let structureId: string;
let yearId: string;
let termId: string;

beforeAll(async () => {
  inst = await createTestInstitution("fp-cb");
  await sql`
    update public.institutions set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10, 'payment_modes', jsonb_build_array('cash')),
      'numbering', jsonb_build_object('admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'))
    where id = ${inst.institutionId}
  `;
  yearId = await createAcademicYear(inst.institutionId);
  termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  structureId = await createFeeStructure(inst.institutionId, yearId, await createGrade(inst.institutionId));
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 1000, frequency: "term" });
});

afterAll(async () => {
  await inst.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function newInvoice(): Promise<string> {
  const [s] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`FP-${crypto.randomUUID().slice(0, 8)}`}, 'T', '2015-01-01', 'other') returning id
  `;
  await createFeeAssignment(inst.institutionId, s.id as string, structureId, yearId);
  const [row] = await sql`select app.generate_invoice(${s.id}::uuid, ${termId}::uuid) as id`;
  return row.id as string;
}

describe("setInstalments curveballs", () => {
  it.each([
    ["fractional paise", [{ dueOn: "2026-05-01", amount: 500.005 }, { dueOn: "2026-06-01", amount: 499.995 }]],
    ["zero part", [{ dueOn: "2026-05-01", amount: 0 }, { dueOn: "2026-06-01", amount: 1000 }]],
    ["negative part", [{ dueOn: "2026-05-01", amount: -1 }, { dueOn: "2026-06-01", amount: 1001 }]],
    ["single part", [{ dueOn: "2026-05-01", amount: 1000 }]],
    ["same due date twice", [{ dueOn: "2026-05-01", amount: 500 }, { dueOn: "2026-05-01", amount: 500 }]],
    ["13 parts", Array.from({ length: 13 }, (_, i) => ({ dueOn: `2027-${String((i % 12) + 1).padStart(2, "0")}-0${i < 12 ? 1 : 2}`, amount: 1 }))],
  ])("%s → validation_failed with fieldErrors.parts; nothing written", async (_l, parts) => {
    const invoiceId = await newInvoice();
    const r = await callAs(inst, "accountant", setInstalments, { invoiceId, parts });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.parts).toBeTruthy();
    const [c] = await sql`select count(*)::int as n from public.invoice_instalments where invoice_id = ${invoiceId}`;
    expect(c.n).toBe(0);
  });

  it("a decimal split (100.10 + 200.20 + 699.70) of a 1000.00 invoice is accepted and stored exactly", async () => {
    const invoiceId = await newInvoice();
    const r = await callAs(inst, "accountant", setInstalments, {
      invoiceId,
      parts: [
        { dueOn: "2026-05-01", amount: 100.1 },
        { dueOn: "2026-06-01", amount: 200.2 },
        { dueOn: "2026-07-01", amount: 699.7 },
      ],
    });
    expect(r.ok).toBe(true);
    const [s] = await sql`select sum(amount)::text as s from public.invoice_instalments where invoice_id = ${invoiceId}`;
    expect(s.s).toBe("1000.00");
  });

  it("parts off by one paisa are refused", async () => {
    const invoiceId = await newInvoice();
    const r = await callAs(inst, "accountant", setInstalments, {
      invoiceId,
      parts: [{ dueOn: "2026-05-01", amount: 500 }, { dueOn: "2026-06-01", amount: 499.99 }],
    });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
  });

  it("teacher and guardian are forbidden", async () => {
    const invoiceId = await newInvoice();
    const parts = [{ dueOn: "2026-05-01", amount: 500 }, { dueOn: "2026-06-01", amount: 500 }];
    for (const role of ["teacher", "guardian"] as const) {
      const r = await callAs(inst, role, setInstalments, { invoiceId, parts });
      expect(r.ok ? null : r.error.code).toBe("forbidden");
    }
  });
});

describe("upsertLateFeeRule curveballs", () => {
  it.each([
    ["per_day without cap", { kind: "per_day", amount: 10 }, "cap"],
    ["per_day cap below amount", { kind: "per_day", amount: 10, cap: 5 }, "cap"],
    ["flat with cap", { kind: "flat", amount: 10, cap: 50 }, "cap"],
    ["fractional paise amount", { kind: "flat", amount: 10.001 }, "amount"],
    ["amount above 100000", { kind: "flat", amount: 100001 }, "amount"],
    ["grace days 91", { kind: "flat", amount: 10, graceDays: 91 }, "graceDays"],
  ])("%s → validation_failed on %s", async (_l, body, field) => {
    const r = await callAs(inst, "accountant", upsertLateFeeRule, { feeStructureId: structureId, ...body });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.[field as string]).toBeTruthy();
  });

  it("teacher is forbidden", async () => {
    const r = await callAs(inst, "teacher", upsertLateFeeRule, { feeStructureId: structureId, kind: "flat", amount: 10 });
    expect(r.ok ? null : r.error.code).toBe("forbidden");
  });
});
