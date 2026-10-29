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
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 finance + numbering keys, set explicitly — institutions.settings
// defaults to '{}' (0002), so app.next_sequence raises invalid_state without
// these patterns, and app.generate_invoice/record_payment's local-FY math
// needs locale.timezone and finance.financial_year_start_month.
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

const FINANCE_TABLES = [
  "fee_structures",
  "fee_components",
  "fee_assignments",
  "concessions",
  "invoices",
  "invoice_lines",
  "payments",
  "receipts",
  "ledger_entries",
];

describe("finance module (T-030) — generate_invoice/record_payment + RLS (C-50..C-54)", () => {
  it("C-50: fee_structures/fee_assignments uniqueness enforced; teacher reads 0 rows from every finance table", async () => {
    const inst = await createTestInstitution("finance-c50");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId, { name: "Standard" });
      await createFeeComponent(inst.institutionId, structureId);
      const studentId = await insertStudent(inst.institutionId, "ADM-C50");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

      await expect(
        sql`insert into public.fee_structures (institution_id, academic_year_id, grade_id, name) values (${inst.institutionId}, ${yearId}, ${gradeId}, 'Standard')`,
      ).rejects.toThrow();

      await expect(
        sql`insert into public.fee_assignments (institution_id, student_id, fee_structure_id, academic_year_id) values (${inst.institutionId}, ${studentId}, ${structureId}, ${yearId})`,
      ).rejects.toThrow();

      for (const table of FINANCE_TABLES) {
        const { data, error } = await inst.clientAs("teacher").from(table).select("*");
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  // 0019 (T-028, lead ruling): fee_structures_select widened so "admissions"
  // (07 §2.2 admissions.enrol, EnrolDialog's fee-structure picker) can read
  // fee structures too — writes stay finance_roles()-only (unchanged).
  it("0019: admissions can read fee_structures in its own institution, 0 rows for another tenant's", async () => {
    const instA = await createTestInstitution("finance-0019-a");
    const instB = await createTestInstitution("finance-0019-b");
    try {
      const yearId = await createAcademicYear(instA.institutionId);
      const gradeId = await createGrade(instA.institutionId);
      await createFeeStructure(instA.institutionId, yearId, gradeId, { name: "Standard" });

      const ownTenant = await instA.clientAs("admissions").from("fee_structures").select("*").eq("institution_id", instA.institutionId);
      expect(ownTenant.error).toBeNull();
      expect(ownTenant.data).toHaveLength(1);

      const otherTenant = await instA.clientAs("admissions").from("fee_structures").select("*").eq("institution_id", instB.institutionId);
      expect(otherTenant.error).toBeNull();
      expect(otherTenant.data).toHaveLength(0);

      // Writes stay finance_roles()-only — admissions can read, not create.
      const insertAttempt = await instA
        .clientAs("admissions")
        .from("fee_structures")
        .insert({ institution_id: instA.institutionId, academic_year_id: yearId, grade_id: gradeId, name: "Admissions-created" });
      expect(insertAttempt.error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("Fix round 1 (CRITICAL): admin is forbidden from generate_invoice/record_payment; accountant and service_role succeed", async () => {
    const inst = await createTestInstitution("finance-fix1");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const studentId = await insertStudent(inst.institutionId, "ADM-FIX1");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

      const adminGenerate = await inst
        .clientAs("admin")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      expect(adminGenerate.error?.message).toBe("code:forbidden");

      const accountantGenerate = await inst
        .clientAs("accountant")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      expect(accountantGenerate.error).toBeNull();
      const invoiceId = accountantGenerate.data as string;

      const adminPay = await inst.clientAs("admin").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(adminPay.error?.message).toBe("code:forbidden");

      const accountantPay = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(accountantPay.error).toBeNull();

      // service_role (the future T-031 job's caller shape) — no auth.uid(), skips the role check.
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SECRET_KEY as string,
      );
      const serviceGenerate = await serviceClient.rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      expect(serviceGenerate.error).toBeNull();
      expect(serviceGenerate.data).toBe(invoiceId); // idempotent — same invoice as above
    } finally {
      await inst.cleanup();
    }
  });

  it("C-51: generate_invoice is idempotent per (student, term); line sum = subtotal; total = subtotal - concession_total", async () => {
    const inst = await createTestInstitution("finance-c51");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      await createFeeComponent(inst.institutionId, structureId, { head: "admission", amount: 5000, frequency: "one_time" });
      const studentId = await insertStudent(inst.institutionId, "ADM-C51");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

      const first = await inst
        .clientAs("accountant")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      expect(first.error).toBeNull();
      const invoiceId = first.data as string;

      const second = await inst
        .clientAs("accountant")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      expect(second.error).toBeNull();
      expect(second.data).toBe(invoiceId);

      const [invoiceCount] = await sql`select count(*)::int as count from public.invoices where student_id = ${studentId}`;
      expect(invoiceCount.count).toBe(1);

      const [invoice] = await sql`select subtotal, concession_total, total from public.invoices where id = ${invoiceId}`;
      const [lineSum] = await sql`select coalesce(sum(amount), 0)::numeric as sum from public.invoice_lines where invoice_id = ${invoiceId}`;

      // Term 1 + first-ever invoice: tuition (term x1 = 10000) + admission (one_time x1 = 5000).
      expect(Number(lineSum.sum)).toBe(Number(invoice.subtotal));
      expect(Number(invoice.subtotal)).toBe(15000);
      expect(Number(invoice.total)).toBe(Number(invoice.subtotal) - Number(invoice.concession_total));
    } finally {
      await inst.cleanup();
    }
  });

  it("C-51b: a one_time component is excluded from a student's second invoice (Term 2)", async () => {
    const inst = await createTestInstitution("finance-c51b");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const term1Id = await createTerm(inst.institutionId, yearId, { sequence: 1, startsOn: "2026-04-01", endsOn: "2026-09-30" });
      const term2Id = await createTerm(inst.institutionId, yearId, { name: "Term 2", sequence: 2, startsOn: "2026-10-01", endsOn: "2027-03-31" });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      await createFeeComponent(inst.institutionId, structureId, { head: "admission", amount: 5000, frequency: "one_time" });
      const studentId = await insertStudent(inst.institutionId, "ADM-C51B");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

      await inst.clientAs("accountant").rpc("generate_invoice", { p_student_id: studentId, p_term_id: term1Id });
      const term2Result = await inst
        .clientAs("accountant")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: term2Id });
      expect(term2Result.error).toBeNull();

      const [term2Invoice] = await sql`select subtotal from public.invoices where id = ${term2Result.data as string}`;
      expect(Number(term2Invoice.subtotal)).toBe(10000); // tuition only — one_time already billed in Term 1
    } finally {
      await inst.cleanup();
    }
  });

  it("C-52/C-53: record_payment is idempotent by key, overpayment is rejected, payments/receipts/invoice_lines/ledger_entries are immutable, and the ledger balances", async () => {
    const inst = await createTestInstitution("finance-c52");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const studentId = await insertStudent(inst.institutionId, "ADM-C52");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

      const generated = await inst
        .clientAs("accountant")
        .rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
      const invoiceId = generated.data as string;

      const idempotencyKey = crypto.randomUUID();
      const first = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 4000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: idempotencyKey,
      });
      expect(first.error).toBeNull();
      const receiptNo1 = (first.data as { receipt_no: string }).receipt_no;

      const second = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 4000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: idempotencyKey,
      });
      expect(second.error).toBeNull();
      expect((second.data as { receipt_no: string }).receipt_no).toBe(receiptNo1);

      const [paymentCount] = await sql`select count(*)::int as count from public.payments where invoice_id = ${invoiceId}`;
      expect(paymentCount.count).toBe(1);
      const [receiptCount] = await sql`
        select count(*)::int as count from public.receipts
        where payment_id in (select id from public.payments where invoice_id = ${invoiceId})
      `;
      expect(receiptCount.count).toBe(1);

      // outstanding is 10000 - 4000 = 6000; 7000 exceeds it.
      const overpay = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 7000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(overpay.error?.message).toBe("code:validation_failed");

      const [paymentRow] = await sql`select id from public.payments where invoice_id = ${invoiceId} limit 1`;
      await expect(sql`update public.payments set amount = 1 where id = ${paymentRow.id}`).rejects.toThrow(/invalid_state/);
      await expect(sql`delete from public.payments where id = ${paymentRow.id}`).rejects.toThrow(/invalid_state/);

      const [receiptRow] = await sql`select id from public.receipts where payment_id = ${paymentRow.id}`;
      await expect(sql`update public.receipts set receipt_no = 'X' where id = ${receiptRow.id}`).rejects.toThrow(/invalid_state/);

      const [lineRow] = await sql`select id from public.invoice_lines where invoice_id = ${invoiceId} limit 1`;
      await expect(sql`update public.invoice_lines set amount = 1 where id = ${lineRow.id}`).rejects.toThrow(/invalid_state/);

      const [ledgerRow] = await sql`select id from public.ledger_entries where invoice_id = ${invoiceId} limit 1`;
      await expect(sql`update public.ledger_entries set debit = 1 where id = ${ledgerRow.id}`).rejects.toThrow(/invalid_state/);

      const [balance] = await sql`
        select coalesce(sum(debit), 0)::numeric as debit, coalesce(sum(credit), 0)::numeric as credit
        from public.ledger_entries where invoice_id = ${invoiceId}
      `;
      expect(Number(balance.debit)).toBe(Number(balance.credit));
    } finally {
      await inst.cleanup();
    }
  });

  it("C-52c: receipt numbers are gap-free per financial year across two payments", async () => {
    const inst = await createTestInstitution("finance-c52c");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const studentA = await insertStudent(inst.institutionId, "ADM-C52C-A");
      const studentB = await insertStudent(inst.institutionId, "ADM-C52C-B");
      await createFeeAssignment(inst.institutionId, studentA, structureId, yearId);
      await createFeeAssignment(inst.institutionId, studentB, structureId, yearId);

      const invoiceA = await inst.clientAs("accountant").rpc("generate_invoice", { p_student_id: studentA, p_term_id: termId });
      const invoiceB = await inst.clientAs("accountant").rpc("generate_invoice", { p_student_id: studentB, p_term_id: termId });

      const paymentA = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceA.data, p_amount: 1000, p_mode: "cash", p_reference: null,
        p_received_at: new Date().toISOString(), p_idempotency_key: crypto.randomUUID(),
      });
      const paymentB = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceB.data, p_amount: 1000, p_mode: "upi", p_reference: "ref-1", p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });

      const seqA = Number((paymentA.data as { receipt_no: string }).receipt_no.split("/")[2]);
      const seqB = Number((paymentB.data as { receipt_no: string }).receipt_no.split("/")[2]);
      expect(seqB).toBe(seqA + 1);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-54: guardian reads only their own children's invoices/invoice_lines/payments/receipts; ledger_entries is never guardian-visible", async () => {
    const inst = await createTestInstitution("finance-c54");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });

      const ownStudentId = await insertStudent(inst.institutionId, "ADM-C54-OWN");
      const otherStudentId = await insertStudent(inst.institutionId, "ADM-C54-OTHER");
      await createFeeAssignment(inst.institutionId, ownStudentId, structureId, yearId);
      await createFeeAssignment(inst.institutionId, otherStudentId, structureId, yearId);

      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${ownStudentId}, 'father', true)
      `;

      const ownInvoice = await inst.clientAs("accountant").rpc("generate_invoice", { p_student_id: ownStudentId, p_term_id: termId });
      await inst.clientAs("accountant").rpc("generate_invoice", { p_student_id: otherStudentId, p_term_id: termId });

      await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: ownInvoice.data, p_amount: 1000, p_mode: "cash", p_reference: null,
        p_received_at: new Date().toISOString(), p_idempotency_key: crypto.randomUUID(),
      });

      const { data: invoices, error: invoicesError } = await inst.clientAs("guardian").from("invoices").select("id");
      expect(invoicesError).toBeNull();
      expect(invoices?.map((r) => r.id)).toEqual([ownInvoice.data]);

      const { data: lines } = await inst.clientAs("guardian").from("invoice_lines").select("invoice_id");
      expect(lines!.length).toBeGreaterThan(0);
      expect(lines?.every((l) => l.invoice_id === ownInvoice.data)).toBe(true);

      const { data: payments } = await inst.clientAs("guardian").from("payments").select("invoice_id");
      expect(payments).toHaveLength(1);
      expect(payments?.every((p) => p.invoice_id === ownInvoice.data)).toBe(true);

      const { data: receipts } = await inst.clientAs("guardian").from("receipts").select("id");
      expect(receipts).toHaveLength(1);

      const { data: ledger, error: ledgerError } = await inst.clientAs("guardian").from("ledger_entries").select("id");
      expect(ledgerError).toBeNull();
      expect(ledger).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
