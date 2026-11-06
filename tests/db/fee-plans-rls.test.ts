import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

// Migration 20261028000087 (X04-T2) — late_fee_rules, invoice_instalments,
// late_fee_charges + RLS, app.invoice_principal, public.set_invoice_instalments,
// public.invoice_instalment_status, app.module_catalog 'fee_plans' row.
// Same direct-RPC shape as tests/db/finance.test.ts / finance-plus-rls.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
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

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return student.id as string;
}

/** Fee structure (one 10000-rupee term-frequency tuition component) + a
 * generated invoice via public.generate_invoice (accountant). Principal
 * of the returned invoice is exactly 10000. due_on = term starts_on (2026-04-01)
 * + default_due_day (10) = 2026-04-11; academic year ends_on = 2027-03-31. */
async function createInvoice(
  inst: TestInstitution,
  admissionNo: string,
  overrides: { isCurrent?: boolean } = {},
): Promise<{ invoiceId: string; studentId: string; structureId: string; yearId: string; gradeId: string }> {
  await setFinanceSettings(inst.institutionId);
  // name/code suffixed by admissionNo: createInvoice may run more than once
  // against the same institution within a test, and academic_years/grades
  // are unique per (institution_id, name)/(institution_id, code); at most
  // one academic_year per institution may have is_current = true.
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
  return { invoiceId: data as string, studentId, structureId, yearId, gradeId };
}

const VALID_PARTS = [
  { due_on: "2026-06-01", amount: 4000 },
  { due_on: "2026-12-01", amount: 3000 },
  { due_on: "2027-02-01", amount: 3000 },
];

describe("fee_plans migration (0087 part 1) — tables, RLS, principal, plans, status", () => {
  it("accountant sets a 3-part plan summing to the principal -> 3 rows + audit row; status is paid/part_paid/due then overdue on replace; replace keeps only the new rows", async () => {
    const inst = await createTestInstitution("fp-happy");
    try {
      const { invoiceId } = await createInvoice(inst, "ADM-FP-HAPPY");

      const set1 = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: invoiceId,
        p_parts: VALID_PARTS,
      });
      expect(set1.error).toBeNull();
      expect(set1.data).toBe(3);

      const rows = await sql`select seq, due_on, amount from public.invoice_instalments where invoice_id = ${invoiceId} order by seq`;
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => Number(r.amount))).toEqual([4000, 3000, 3000]);

      const [auditRow] = await sql`
        select action from public.audit_events
        where entity_id = ${invoiceId} and action = 'fee_plans.instalments.set'
        order by created_at desc limit 1
      `;
      expect(auditRow.action).toBe("fee_plans.instalments.set");

      // Pay part 1 (4000) + half of part 2 (1500) = 5500.
      const pay = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 5500,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(pay.error).toBeNull();

      const status1 = await inst.clientAs("accountant").rpc("invoice_instalment_status", {
        p_institution_id: inst.institutionId,
        p_invoice_id: invoiceId,
      });
      expect(status1.error).toBeNull();
      const byseq1 = Object.fromEntries((status1.data as { seq: number; status: string }[]).map((r) => [r.seq, r.status]));
      expect(byseq1[1]).toBe("paid"); // fully covered
      expect(byseq1[2]).toBe("part_paid"); // half paid, due_on (2026-12-01) still in the future
      expect(byseq1[3]).toBe("due"); // untouched

      // Replace with part 2's due_on moved into the past -> same partial
      // payment now reads as overdue instead of part_paid.
      const set2 = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: invoiceId,
        p_parts: [VALID_PARTS[0], { due_on: "2026-09-01", amount: 3000 }, VALID_PARTS[2]],
      });
      expect(set2.error).toBeNull();

      const rowsAfterReplace = await sql`select due_on::text as due_on from public.invoice_instalments where invoice_id = ${invoiceId} order by seq`;
      expect(rowsAfterReplace).toHaveLength(3); // old rows gone, only the new 3 remain
      expect(rowsAfterReplace[1].due_on).toBe("2026-09-01");

      const status2 = await inst.clientAs("accountant").rpc("invoice_instalment_status", {
        p_institution_id: inst.institutionId,
        p_invoice_id: invoiceId,
      });
      const byseq2 = Object.fromEntries((status2.data as { seq: number; status: string }[]).map((r) => [r.seq, r.status]));
      expect(byseq2[2]).toBe("overdue");
    } finally {
      await inst.cleanup();
    }
  });

  it.each([
    ["sum != principal", [{ due_on: "2026-06-01", amount: 4000 }, { due_on: "2026-12-01", amount: 3000 }]],
    ["1 part", [{ due_on: "2026-06-01", amount: 10000 }]],
    [
      "13 parts",
      Array.from({ length: 13 }, (_, i) => ({ due_on: `2026-${String(4 + i).padStart(2, "0")}-15`, amount: 769.24 })),
    ],
    [
      "non-increasing dates",
      [{ due_on: "2026-06-01", amount: 5000 }, { due_on: "2026-06-01", amount: 5000 }],
    ],
    [
      "first part before invoice due_on",
      [{ due_on: "2026-04-01", amount: 5000 }, { due_on: "2026-12-01", amount: 5000 }],
    ],
    [
      "last part after academic year end",
      [{ due_on: "2026-06-01", amount: 5000 }, { due_on: "2027-04-15", amount: 5000 }],
    ],
  ])("%s -> validation_failed", async (_label, parts) => {
    const inst = await createTestInstitution("fp-validation");
    try {
      const { invoiceId } = await createInvoice(inst, "ADM-FP-VAL");
      const { error } = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: invoiceId,
        p_parts: parts,
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a library_fine / late_fee line is excluded from app.invoice_principal", async () => {
    const inst = await createTestInstitution("fp-principal");
    try {
      const { invoiceId } = await createInvoice(inst, "ADM-FP-PRIN");
      const [before] = await sql`select app.invoice_principal(${invoiceId}::uuid) as principal`;
      expect(Number(before.principal)).toBe(10000);

      await sql`
        insert into public.invoice_lines (institution_id, invoice_id, head, description, amount)
        values (${inst.institutionId}, ${invoiceId}, 'library_fine', 'Library fine', 50)
      `;

      const [after] = await sql`select app.invoice_principal(${invoiceId}::uuid) as principal`;
      expect(Number(after.principal)).toBe(10000); // unchanged
    } finally {
      await inst.cleanup();
    }
  });

  it("paid invoice -> invalid_state; cancelled invoice -> invalid_state", async () => {
    const inst = await createTestInstitution("fp-state");
    try {
      const { invoiceId: paidInvoiceId } = await createInvoice(inst, "ADM-FP-PAID");
      const pay = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: paidInvoiceId,
        p_amount: 10000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(pay.error).toBeNull();

      const onPaid = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: paidInvoiceId,
        p_parts: VALID_PARTS,
      });
      expect(onPaid.error?.message).toContain("code:invalid_state");

      const { invoiceId: cancelledInvoiceId } = await createInvoice(inst, "ADM-FP-CANCEL", { isCurrent: false });
      await sql`update public.invoices set status = 'cancelled' where id = ${cancelledInvoiceId}`;
      const onCancelled = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: cancelledInvoiceId,
        p_parts: VALID_PARTS,
      });
      expect(onCancelled.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin and teacher -> forbidden; principal of B on A's invoice -> not_found", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const { invoiceId } = await createInvoice(a, "ADM-FP-XTENANT");

      const admin = await a.clientAs("admin").rpc("set_invoice_instalments", { p_invoice_id: invoiceId, p_parts: VALID_PARTS });
      expect(admin.error?.message).toContain("code:forbidden");

      const teacher = await a.clientAs("teacher").rpc("set_invoice_instalments", { p_invoice_id: invoiceId, p_parts: VALID_PARTS });
      expect(teacher.error?.message).toContain("code:forbidden");

      const crossTenant = await b.clientAs("principal").rpc("set_invoice_instalments", { p_invoice_id: invoiceId, p_parts: VALID_PARTS });
      expect(crossTenant.error?.message).toContain("code:not_found");
    });
  });

  it("a plan cannot be set after a late_fee_charges row exists on the invoice -> invalid_state", async () => {
    const inst = await createTestInstitution("fp-locked");
    try {
      const { invoiceId, structureId } = await createInvoice(inst, "ADM-FP-LOCKED");

      const rule = await inst.clientAs("accountant").from("late_fee_rules").insert({
        institution_id: inst.institutionId,
        fee_structure_id: structureId,
        kind: "flat",
        amount: 100,
      }).select("id").single();
      expect(rule.error).toBeNull();

      const [line] = await sql`
        insert into public.invoice_lines (institution_id, invoice_id, head, description, amount)
        values (${inst.institutionId}, ${invoiceId}, 'late_fee', 'Late fee', 100)
        returning id
      `;
      await sql`
        insert into public.late_fee_charges (institution_id, invoice_id, unit_seq, charge_date, days_late, amount, rule_id, invoice_line_id)
        values (${inst.institutionId}, ${invoiceId}, 0, current_date, 1, 100, ${rule.data!.id}, ${line.id})
      `;

      const { error } = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
        p_invoice_id: invoiceId,
        p_parts: VALID_PARTS,
      });
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("guardian reads own child's instalments + charges; another family sees none; teacher sees none", async () => {
    const inst = await createTestInstitution("fp-scope");
    try {
      const { invoiceId, studentId } = await createInvoice(inst, "ADM-FP-SCOPE");
      await inst.clientAs("accountant").rpc("set_invoice_instalments", { p_invoice_id: invoiceId, p_parts: VALID_PARTS });

      const [guardianRow] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
      `;

      const guardianView = await inst.clientAs("guardian").from("invoice_instalments").select("id").eq("invoice_id", invoiceId);
      expect(guardianView.data).toHaveLength(3);

      const teacherView = await inst.clientAs("teacher").from("invoice_instalments").select("id").eq("invoice_id", invoiceId);
      expect(teacherView.data).toHaveLength(0);

      const other = await createTestInstitution("fp-scope-other-family");
      try {
        const otherFamilyView = await other.clientAs("guardian").from("invoice_instalments").select("id").eq("invoice_id", invoiceId);
        expect(otherFamilyView.data).toHaveLength(0);
      } finally {
        await other.cleanup();
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("accountant inserts a rule for own structure; B's structure -> rejected; per_day without cap / flat with cap -> rejected; admin reads rules but cannot insert", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const { structureId: structureA, yearId: yearA, gradeId: gradeA } = await createInvoice(a, "ADM-FP-RULE-A");
      const { structureId: structureB } = await createInvoice(b, "ADM-FP-RULE-B");

      const ownStructure = await a.clientAs("accountant").from("late_fee_rules").insert({
        institution_id: a.institutionId,
        fee_structure_id: structureA,
        kind: "flat",
        amount: 50,
      });
      expect(ownStructure.error).toBeNull();

      const crossStructure = await a.clientAs("accountant").from("late_fee_rules").insert({
        institution_id: a.institutionId,
        fee_structure_id: structureB,
        kind: "flat",
        amount: 50,
      });
      expect(crossStructure.error).not.toBeNull();

      const structureA2 = await createFeeStructure(a.institutionId, yearA, gradeA, { name: "Second" });
      const perDayNoCap = await a.clientAs("accountant").from("late_fee_rules").insert({
        institution_id: a.institutionId,
        fee_structure_id: structureA2,
        kind: "per_day",
        amount: 10,
      });
      expect(perDayNoCap.error).not.toBeNull();

      const flatWithCap = await b.clientAs("accountant").from("late_fee_rules").insert({
        institution_id: b.institutionId,
        fee_structure_id: structureB,
        kind: "flat",
        amount: 50,
        cap: 100,
      });
      expect(flatWithCap.error).not.toBeNull();

      const adminRead = await a.clientAs("admin").from("late_fee_rules").select("id").eq("institution_id", a.institutionId);
      expect(adminRead.data).toHaveLength(1);

      const adminInsert = await a.clientAs("admin").from("late_fee_rules").insert({
        institution_id: a.institutionId,
        fee_structure_id: structureA2,
        kind: "flat",
        amount: 50,
      });
      expect(adminInsert.error).not.toBeNull(); // app.finance_write_roles() excludes admin
    });
  });

  it("update/delete of late_fee_charges is rejected for every role, even owner", async () => {
    const inst = await createTestInstitution("fp-immutable");
    try {
      const { invoiceId, structureId } = await createInvoice(inst, "ADM-FP-IMMUT");
      const [rule] = await sql`
        insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount)
        values (${inst.institutionId}, ${structureId}, 'flat', 100)
        returning id
      `;
      const [line] = await sql`
        insert into public.invoice_lines (institution_id, invoice_id, head, description, amount)
        values (${inst.institutionId}, ${invoiceId}, 'late_fee', 'Late fee', 100)
        returning id
      `;
      const [charge] = await sql`
        insert into public.late_fee_charges (institution_id, invoice_id, unit_seq, charge_date, days_late, amount, rule_id, invoice_line_id)
        values (${inst.institutionId}, ${invoiceId}, 0, current_date, 1, 100, ${rule.id}, ${line.id})
        returning id
      `;

      // No UPDATE/DELETE policy at all on late_fee_charges (lesson 3): even
      // the owner role matches 0 rows, silently, before the block_mutation
      // trigger is ever reached.
      const update = await inst.clientAs("owner").from("late_fee_charges").update({ amount: 999 }).eq("id", charge.id).select("id");
      expect(update.error).toBeNull();
      expect(update.data).toHaveLength(0);

      const del = await inst.clientAs("owner").from("late_fee_charges").delete().eq("id", charge.id).select("id");
      expect(del.error).toBeNull();
      expect(del.data).toHaveLength(0);

      // service_role bypasses RLS entirely, so this is the path that
      // actually reaches app.block_mutation().
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SECRET_KEY as string,
      );
      const serviceUpdate = await serviceClient.from("late_fee_charges").update({ amount: 999 }).eq("id", charge.id);
      expect(serviceUpdate.error?.message ?? "").toContain("code:invalid_state");

      const unchanged = await sql`select amount from public.late_fee_charges where id = ${charge.id}`;
      expect(Number(unchanged[0].amount)).toBe(100);
    } finally {
      await inst.cleanup();
    }
  });

  it("app.module_enabled(inst, 'fee_plans') is false when finance_plus is stored false, true otherwise", async () => {
    const inst = await createTestInstitution("fp-module");
    try {
      await sql`
        update public.institutions set settings = settings || '{"modules": {"finance_plus": false}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const [off] = await sql`select app.module_enabled(${inst.institutionId}::uuid, 'fee_plans') as enabled`;
      expect(off.enabled).toBe(false);

      await sql`
        update public.institutions set settings = settings || '{"modules": {"finance_plus": true}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const [on] = await sql`select app.module_enabled(${inst.institutionId}::uuid, 'fee_plans') as enabled`;
      expect(on.enabled).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });
});
