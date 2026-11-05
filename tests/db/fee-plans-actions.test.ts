import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
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
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// X04-T5 — feePlans.lateFeeRule.upsert / feePlans.instalments.set. Fixtures
// local to this file (same shape as tests/db/fee-plans-late-fees-sql.test.ts).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function setFinanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object(
        'financial_year_start_month', 4, 'default_due_day', 10,
        'payment_modes', jsonb_build_array('cash', 'upi', 'cheque', 'neft', 'card')
      ),
      'numbering', jsonb_build_object(
        'admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'
      )
    )
    where id = ${institutionId}
  `;
}

async function setupStructure(
  institutionId: string,
  label: string,
): Promise<{ structureId: string; yearId: string; termId: string }> {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId, { name: `2026-27-${label}` });
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId, { code: `G-${label}` });
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  return { structureId, yearId, termId };
}

async function setupInvoice(
  institutionId: string,
  structureId: string,
  yearId: string,
  termId: string,
  admissionNo: string,
  amount = 12000,
): Promise<{ invoiceId: string; dueOn: string }> {
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  const studentId = student.id as string;
  await createFeeAssignment(institutionId, studentId, structureId, yearId);
  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  const invoiceId = row.id as string;
  const [invoice] = await sql`select due_on::text as due_on from public.invoices where id = ${invoiceId}`;
  return { invoiceId, dueOn: invoice.due_on as string };
}

async function payInvoiceFull(invoiceId: string, amount: number): Promise<void> {
  await sql`select app.record_payment(${invoiceId}::uuid, ${amount}, 'cash', null, now(), ${crypto.randomUUID()}) as result`;
}

function daysAfter(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("feePlans.lateFeeRule.upsert", () => {
  it("accountant upserts a per_day rule; a second upsert updates the same row (one row, two audit rows)", async () => {
    const inst = await createTestInstitution("fp-act-rule");
    try {
      const { structureId } = await setupStructure(inst.institutionId, "rule");

      const first = await callAs(inst, "accountant", upsertLateFeeRule, {
        feeStructureId: structureId,
        kind: "per_day",
        amount: 10,
        graceDays: 2,
        cap: 50,
        isActive: true,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const ruleId = first.data.id;

      const second = await callAs(inst, "accountant", upsertLateFeeRule, {
        feeStructureId: structureId,
        kind: "per_day",
        amount: 15,
        graceDays: 3,
        cap: 60,
        isActive: true,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.id).toBe(ruleId);

      const rows = await sql`select amount::numeric as amount, grace_days from public.late_fee_rules where fee_structure_id = ${structureId}`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(15);

      const auditRows = await sql`
        select id from public.audit_events
        where entity_type = 'late_fee_rule' and entity_id = ${ruleId} and action = 'fee_plans.late_fee_rule.upserted'
      `;
      expect(auditRows).toHaveLength(2);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("another institution's fee structure → not_found", async () => {
    const instA = await createTestInstitution("fp-act-rule-a");
    const instB = await createTestInstitution("fp-act-rule-b");
    try {
      const { structureId: structureIdB } = await setupStructure(instB.institutionId, "rule-b");

      const result = await callAs(instA, "accountant", upsertLateFeeRule, {
        feeStructureId: structureIdB,
        kind: "flat",
        amount: 100,
        cap: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("admin cannot upsert a late-fee rule", async () => {
    const inst = await createTestInstitution("fp-act-rule-admin");
    try {
      const { structureId } = await setupStructure(inst.institutionId, "rule-admin");

      const result = await callAs(inst, "admin", upsertLateFeeRule, {
        feeStructureId: structureId,
        kind: "flat",
        amount: 100,
        cap: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("fee_plans module off → forbidden", async () => {
    const inst = await createTestInstitution("fp-act-rule-off");
    try {
      const { structureId } = await setupStructure(inst.institutionId, "rule-off");
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,fee_plans}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;

      const result = await callAs(inst, "accountant", upsertLateFeeRule, {
        feeStructureId: structureId,
        kind: "flat",
        amount: 100,
        cap: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("feePlans.instalments.set", () => {
  it("accountant sets a 3-part plan summing to the invoice principal", async () => {
    const inst = await createTestInstitution("fp-act-plan");
    try {
      const { structureId, yearId, termId } = await setupStructure(inst.institutionId, "plan");
      const { invoiceId, dueOn } = await setupInvoice(inst.institutionId, structureId, yearId, termId, "ADM-PLAN", 12000);

      const parts = [
        { dueOn: daysAfter(dueOn, 10), amount: 4000 },
        { dueOn: daysAfter(dueOn, 40), amount: 4000 },
        { dueOn: daysAfter(dueOn, 70), amount: 4000 },
      ];
      const result = await callAs(inst, "accountant", setInstalments, { invoiceId, parts });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ invoiceId, parts });

      const rows = await sql`select seq, amount::numeric as amount from public.invoice_instalments where invoice_id = ${invoiceId} order by seq`;
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => Number(r.amount))).toEqual([4000, 4000, 4000]);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("parts not summing to principal → validation_failed with fieldErrors.parts", async () => {
    const inst = await createTestInstitution("fp-act-plan-sum");
    try {
      const { structureId, yearId, termId } = await setupStructure(inst.institutionId, "plan-sum");
      const { invoiceId, dueOn } = await setupInvoice(inst.institutionId, structureId, yearId, termId, "ADM-PLAN-SUM", 12000);

      const parts = [
        { dueOn: daysAfter(dueOn, 10), amount: 1000 },
        { dueOn: daysAfter(dueOn, 40), amount: 1000 },
      ];
      const result = await callAs(inst, "accountant", setInstalments, { invoiceId, parts });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors?.parts).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("paid invoice → invalid_state", async () => {
    const inst = await createTestInstitution("fp-act-plan-paid");
    try {
      const { structureId, yearId, termId } = await setupStructure(inst.institutionId, "plan-paid");
      const { invoiceId, dueOn } = await setupInvoice(inst.institutionId, structureId, yearId, termId, "ADM-PLAN-PAID", 9000);
      await payInvoiceFull(invoiceId, 9000);

      const parts = [
        { dueOn: daysAfter(dueOn, 10), amount: 4500 },
        { dueOn: daysAfter(dueOn, 40), amount: 4500 },
      ];
      const result = await callAs(inst, "accountant", setInstalments, { invoiceId, parts });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("another institution's invoice → not_found; no instalments written", async () => {
    const instA = await createTestInstitution("fp-act-plan-a");
    const instB = await createTestInstitution("fp-act-plan-b");
    try {
      const { structureId, yearId, termId } = await setupStructure(instB.institutionId, "plan-b");
      const { invoiceId, dueOn } = await setupInvoice(instB.institutionId, structureId, yearId, termId, "ADM-PLAN-B", 12000);

      const parts = [
        { dueOn: daysAfter(dueOn, 10), amount: 6000 },
        { dueOn: daysAfter(dueOn, 40), amount: 6000 },
      ];
      const result = await callAs(instA, "accountant", setInstalments, { invoiceId, parts });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");

      const rows = await sql`select id from public.invoice_instalments where invoice_id = ${invoiceId}`;
      expect(rows).toHaveLength(0);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("fee_plans module off → forbidden", async () => {
    const inst = await createTestInstitution("fp-act-plan-off");
    try {
      const { structureId, yearId, termId } = await setupStructure(inst.institutionId, "plan-off");
      const { invoiceId, dueOn } = await setupInvoice(inst.institutionId, structureId, yearId, termId, "ADM-PLAN-OFF", 8000);
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,fee_plans}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;

      const parts = [
        { dueOn: daysAfter(dueOn, 10), amount: 4000 },
        { dueOn: daysAfter(dueOn, 40), amount: 4000 },
      ];
      const result = await callAs(inst, "accountant", setInstalments, { invoiceId, parts });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
