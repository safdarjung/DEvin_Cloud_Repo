// X04-T6 — src/modules/fee-plans/queries.ts + query-defs.ts, called via
// callAs (same buildContext/setActingClient pattern as
// tests/db/library-queries.test.ts). Migration 20261028000087 (X04-T2/T4)
// owns late_fee_rules/invoice_instalments/late_fee_charges + RLS; these
// tests exercise the TS query layer on top, not the SQL itself.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { closeActionsHelper } from "../helpers/actions";
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
import { instalmentsQuery, lateFeeRulesQuery } from "@/modules/fee-plans/query-defs";
import { callAs } from "../helpers/actions";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function setFinanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10),
      'numbering', jsonb_build_object(
        'admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'
      )
    )
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return student.id as string;
}

/** One 10000-rupee term-tuition fee structure + a generated invoice (same shape as tests/db/fee-plans-rls.test.ts's createInvoice). Invoice due_on (term start + default_due_day) lands in the past relative to "today", so a part due on it is already overdue without backdating. */
async function createInvoice(
  inst: TestInstitution,
  admissionNo: string,
  overrides: { isCurrent?: boolean } = {},
): Promise<{ invoiceId: string; studentId: string; structureId: string; yearId: string }> {
  await setFinanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId, {
    name: `2026-27-${admissionNo}`,
    isCurrent: overrides.isCurrent ?? true,
  });
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId, { code: `VI-${admissionNo}` });
  const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
  const studentId = await insertStudent(inst.institutionId, admissionNo);
  await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

  const { data, error } = await inst.clientAs("accountant").rpc("generate_invoice", {
    p_student_id: studentId,
    p_term_id: termId,
  });
  if (error) throw error;
  return { invoiceId: data as string, studentId, structureId, yearId };
}

async function linkGuardian(institutionId: string, studentId: string): Promise<void> {
  const [guardianRow] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
  `;
}

describe("feePlans.lateFeeRules", () => {
  it("accountant lists every current-year fee structure — one with a rule, one without; teacher -> forbidden", async () => {
    const inst = await createTestInstitution("fp-q-rules");
    try {
      const yearId = await createAcademicYear(inst.institutionId, { name: "2026-27", isCurrent: true });
      const gradeA = await createGrade(inst.institutionId, { code: "I" });
      const gradeB = await createGrade(inst.institutionId, { code: "XI" });
      const structureA = await createFeeStructure(inst.institutionId, yearId, gradeA, { name: "Grade I" });
      const structureB = await createFeeStructure(inst.institutionId, yearId, gradeB, { name: "Grade XI" });

      await sql`
        insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount, grace_days, cap)
        values (${inst.institutionId}, ${structureA}, 'per_day', 10, 5, 300)
      `;

      const result = await callAs(inst, "accountant", lateFeeRulesQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);

      const withRule = result.data.find((r) => r.feeStructureId === structureA);
      const withoutRule = result.data.find((r) => r.feeStructureId === structureB);
      expect(withRule?.rule).toEqual({ id: expect.any(String), kind: "per_day", amount: 10, graceDays: 5, cap: 300, isActive: true });
      expect(withRule?.gradeName).toBe("Grade I");
      expect(withoutRule?.rule).toBeNull();

      const forbidden = await callAs(inst, "teacher", lateFeeRulesQuery, {});
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("feePlans.instalments", () => {
  it("guardian reads own child's plan (derived statuses + a late-fee row); another family's invoice -> null; no-plan invoice -> parts: []", async () => {
    const inst = await createTestInstitution("fp-q-instalments");
    try {
      // A: guardian's own child, with a 2-part plan (part 1 on the invoice's
      // own due_on -> already overdue; part 2 in the future) + one manually
      // seeded late-fee charge on unit 1 (apply_late_fees itself is T4's).
      const planned = await createInvoice(inst, "ADM-FP-Q-PLAN");
      await linkGuardian(inst.institutionId, planned.studentId);

      const [invoiceRow] = await sql`select due_on::text as due_on from public.invoices where id = ${planned.invoiceId}`;
      const set = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: planned.invoiceId,
        p_parts: [
          { due_on: invoiceRow.due_on, amount: 6000 },
          { due_on: "2027-02-01", amount: 4000 },
        ],
      });
      expect(set.error).toBeNull();

      const [rule] = await sql`
        insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount, grace_days)
        values (${inst.institutionId}, ${planned.structureId}, 'flat', 200, 3)
        returning id
      `;
      const [line] = await sql`
        insert into public.invoice_lines (institution_id, invoice_id, head, description, amount)
        values (${inst.institutionId}, ${planned.invoiceId}, 'late_fee', 'Late fee — instalment 1', 200)
        returning id
      `;
      await sql`
        insert into public.late_fee_charges (institution_id, invoice_id, unit_seq, charge_date, days_late, amount, rule_id, invoice_line_id)
        values (${inst.institutionId}, ${planned.invoiceId}, 1, current_date, 5, 200, ${rule.id}, ${line.id})
      `;

      // B: a different family's invoice — never linked to this guardian.
      const unlinked = await createInvoice(inst, "ADM-FP-Q-OTHER", { isCurrent: false });

      // C: guardian's own child again, no plan ever set.
      const noPlan = await createInvoice(inst, "ADM-FP-Q-NOPLAN", { isCurrent: false });
      await linkGuardian(inst.institutionId, noPlan.studentId);

      const own = await callAs(inst, "guardian", instalmentsQuery, { invoiceId: planned.invoiceId });
      expect(own.ok).toBe(true);
      if (own.ok) {
        expect(own.data?.invoiceId).toBe(planned.invoiceId);
        expect(own.data?.total).toBe(10000);
        expect(own.data?.paidTotal).toBe(0);
        expect(own.data?.parts.map((p) => [p.seq, p.amount, p.status])).toEqual([
          [1, 6000, "overdue"],
          [2, 4000, "due"],
        ]);
        expect(own.data?.lateFees).toEqual([{ chargeDate: expect.any(String), unitSeq: 1, daysLate: 5, amount: 200 }]);
      }

      const other = await callAs(inst, "guardian", instalmentsQuery, { invoiceId: unlinked.invoiceId });
      expect(other.ok).toBe(true);
      if (other.ok) expect(other.data).toBeNull();

      const noPlanResult = await callAs(inst, "guardian", instalmentsQuery, { invoiceId: noPlan.invoiceId });
      expect(noPlanResult.ok).toBe(true);
      if (noPlanResult.ok) {
        expect(noPlanResult.data?.parts).toEqual([]);
        expect(noPlanResult.data?.lateFees).toEqual([]);
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
