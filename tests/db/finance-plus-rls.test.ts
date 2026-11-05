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
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// Migration 20261028000074 (M12-T4): payment_reversals + app.void_payment /
// public.void_payment, fee_reminders + public.enqueue_fee_reminders,
// notification_preferences 'finance' category, public.finance_collection_report.
// Direct RPC/table tests (actions ship in T7/T8/T9) — same shape as
// tests/db/enqueue-term-invoices.test.ts and tests/db/finance.test.ts's C-54.

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

/** Term + default fee structure (one tuition component) + a generated invoice for one student. */
async function setupInvoice(institutionId: string, admissionNo: string, amount = 10000) {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const studentId = await insertStudent(institutionId, admissionNo);
  await createFeeAssignment(institutionId, studentId, structureId, yearId);

  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  return { yearId, termId, gradeId, studentId, invoiceId: row.id as string };
}

async function ledgerBalance(institutionId: string): Promise<number> {
  const [row] = await sql`
    select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) as diff
    from public.ledger_entries where institution_id = ${institutionId}
  `;
  return Number(row.diff);
}

describe("migration 20261028000074: payment_reversals + app.void_payment / public.void_payment", () => {
  it("principal voids a full cash payment: reversal row, invoice back to issued/0, balanced ledger", async () => {
    const inst = await createTestInstitution("void-happy");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-1", 5000);
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 5000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(payment.error).toBeNull();
      const paymentId = (payment.data as { payment_id: string }).payment_id;

      const result = await inst.clientAs("principal").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "cashier entry error",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error).toBeNull();
      const data = result.data as { reversal_id: string; invoice_id: string; invoice_status: string; paid_total: number };
      expect(data.invoice_id).toBe(invoiceId);
      expect(data.invoice_status).toBe("issued");
      expect(Number(data.paid_total)).toBe(0);

      const [invoiceRow] = await sql`select status, paid_total from public.invoices where id = ${invoiceId}`;
      expect(invoiceRow.status).toBe("issued");
      expect(Number(invoiceRow.paid_total)).toBe(0);

      const ledgerRows = await sql`
        select account, debit, credit from public.ledger_entries
        where payment_id = ${paymentId} and debit > 0 and account = 'fees_receivable'
      `;
      expect(ledgerRows).toHaveLength(1);
      const cashRows = await sql`
        select account, credit from public.ledger_entries
        where payment_id = ${paymentId} and credit > 0 and account = 'cash'
      `;
      expect(cashRows).toHaveLength(1);

      expect(await ledgerBalance(inst.institutionId)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("re-recording the same amount after a void succeeds and the ledger still balances", async () => {
    const inst = await createTestInstitution("void-rerecord");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-2", 3000);
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 3000,
        p_mode: "upi",
        p_reference: "ref-1",
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;

      const voidResult = await inst.clientAs("owner").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "wrong student charged",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(voidResult.error).toBeNull();

      const second = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 3000,
        p_mode: "upi",
        p_reference: "ref-2",
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(second.error).toBeNull();

      const [invoiceRow] = await sql`select status, paid_total from public.invoices where id = ${invoiceId}`;
      expect(invoiceRow.status).toBe("paid");
      expect(Number(invoiceRow.paid_total)).toBe(3000);

      expect(await ledgerBalance(inst.institutionId)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("replaying the same idempotency key returns the same reversal; a new key on an already-reversed payment is a conflict", async () => {
    const inst = await createTestInstitution("void-idempotent");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-3", 2000);
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 2000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;
      const key = crypto.randomUUID();

      const first = await inst.clientAs("principal").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "duplicate entry",
        p_idempotency_key: key,
      });
      expect(first.error).toBeNull();
      const firstReversalId = (first.data as { reversal_id: string }).reversal_id;

      const replay = await inst.clientAs("principal").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "duplicate entry",
        p_idempotency_key: key,
      });
      expect(replay.error).toBeNull();
      expect((replay.data as { reversal_id: string }).reversal_id).toBe(firstReversalId);

      const reversalCount = await sql`select count(*)::int as n from public.payment_reversals where payment_id = ${paymentId}`;
      expect(reversalCount[0]?.n).toBe(1);

      const conflictResult = await inst.clientAs("principal").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "second attempt new key",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(conflictResult.error).toBeTruthy();
      expect(conflictResult.error?.message).toMatch(/conflict/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant and admin are forbidden; a principal of another institution gets not_found", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const { invoiceId } = await setupInvoice(instA.institutionId, "ADM-VOID-ROLES");
      const payment = await instA.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;

      const accountantResult = await instA.clientAs("accountant").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "accountant tries to void",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(accountantResult.error?.message).toMatch(/forbidden/i);

      const adminResult = await instA.clientAs("admin").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "admin tries to void",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(adminResult.error?.message).toMatch(/forbidden/i);

      const crossTenantResult = await instB.clientAs("principal").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "principal of B tries A's payment",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(crossTenantResult.error?.message).toMatch(/not_found/i);
    });
  });

  it("cheque_bounce on a cash payment is validation_failed", async () => {
    const inst = await createTestInstitution("void-cheque-bounce");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-CB");
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;

      const result = await inst.clientAs("owner").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "cheque_bounce",
        p_reason: "cheque bounced",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error?.message).toMatch(/validation_failed/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("payment_reversals rows reject direct UPDATE/DELETE (immutable history)", async () => {
    const inst = await createTestInstitution("void-immutable");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-IMM");
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;
      const voided = await inst.clientAs("owner").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "immutability check",
        p_idempotency_key: crypto.randomUUID(),
      });
      const reversalId = (voided.data as { reversal_id: string }).reversal_id;

      await expect(
        sql`update public.payment_reversals set reason = 'tampered' where id = ${reversalId}`,
      ).rejects.toThrow(/invalid_state/i);
      await expect(sql`delete from public.payment_reversals where id = ${reversalId}`).rejects.toThrow(/invalid_state/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian sees only their own child's reversal; teacher sees none", async () => {
    const inst = await createTestInstitution("void-guardian-scope");
    try {
      const { invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-VOID-GUARD");
      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true)
      `;

      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;
      await inst.clientAs("owner").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "guardian scope check",
        p_idempotency_key: crypto.randomUUID(),
      });

      const { data: guardianRows } = await inst.clientAs("guardian").from("payment_reversals").select("id, invoice_id");
      expect(guardianRows).toHaveLength(1);
      expect(guardianRows?.[0]?.invoice_id).toBe(invoiceId);

      const { data: teacherRows, error: teacherError } = await inst.clientAs("teacher").from("payment_reversals").select("id");
      expect(teacherError).toBeNull();
      expect(teacherRows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000074: public.enqueue_fee_reminders", () => {
  it("accountant enqueues a job {term_id, as_of}; the same day twice returns the same job; teacher forbidden; another institution's term is not_found", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const termA = await createTerm(instA.institutionId, yearA, { sequence: 1 });

      const teacherResult = await instA.clientAs("teacher").rpc("enqueue_fee_reminders", {
        p_institution_id: instA.institutionId,
        p_term_id: termA,
      });
      expect(teacherResult.error?.message).toMatch(/forbidden/i);

      const first = await instA.clientAs("accountant").rpc("enqueue_fee_reminders", {
        p_institution_id: instA.institutionId,
        p_term_id: termA,
      });
      expect(first.error).toBeNull();
      const firstJobId = (first.data as { jobId: string }).jobId;
      expect(firstJobId).toBeTruthy();

      const second = await instA.clientAs("accountant").rpc("enqueue_fee_reminders", {
        p_institution_id: instA.institutionId,
        p_term_id: termA,
      });
      expect(second.error).toBeNull();
      expect((second.data as { jobId: string }).jobId).toBe(firstJobId);

      const jobs = await sql`select type, payload from public.jobs where id = ${firstJobId}::uuid`;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.type).toBe("finance.fee_reminder");
      expect(jobs[0]?.payload).toMatchObject({ term_id: termA });

      const count = await sql`select count(*)::int as n from public.jobs where institution_id = ${instA.institutionId} and type = 'finance.fee_reminder'`;
      expect(count[0]?.n).toBe(1);

      const crossTenantResult = await instB.clientAs("accountant").rpc("enqueue_fee_reminders", {
        p_institution_id: instB.institutionId,
        p_term_id: termA,
      });
      expect(crossTenantResult.error?.message).toMatch(/not_found/i);
    });
  });
});

describe("migration 20261028000074: fee_reminders table RLS", () => {
  it("is invisible to guardian/teacher but visible to finance roles", async () => {
    const inst = await createTestInstitution("fee-reminders-rls");
    try {
      const { invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-FR-RLS");
      const [{ user_id: ownerUserId }] = await sql`
        select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'owner'
      `;
      await sql`
        insert into public.fee_reminders (institution_id, invoice_id, student_id, recipient_user_id, reminder_date, outstanding)
        values (${inst.institutionId}, ${invoiceId}, ${studentId}, ${ownerUserId}, current_date, 1000)
      `;

      const { data: ownerRows } = await inst.clientAs("owner").from("fee_reminders").select("id");
      expect(ownerRows).toHaveLength(1);

      const { data: guardianRows, error: guardianError } = await inst.clientAs("guardian").from("fee_reminders").select("id");
      expect(guardianError).toBeNull();
      expect(guardianRows).toHaveLength(0);

      const { data: teacherRows, error: teacherError } = await inst.clientAs("teacher").from("fee_reminders").select("id");
      expect(teacherError).toBeNull();
      expect(teacherRows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000074: public.finance_collection_report", () => {
  it("returns exact sums by grade/term/mode with a void counted in reversed; bad group_by is validation_failed", async () => {
    const inst = await createTestInstitution("collection-report");
    try {
      const { yearId, termId, gradeId, invoiceId } = await setupInvoice(inst.institutionId, "ADM-CR-1", 4000);
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: 4000,
        p_mode: "cash",
        p_reference: null,
        p_received_at: new Date().toISOString(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const paymentId = (payment.data as { payment_id: string }).payment_id;
      await inst.clientAs("owner").rpc("void_payment", {
        p_payment_id: paymentId,
        p_kind: "void",
        p_reason: "collection report fixture void",
        p_idempotency_key: crypto.randomUUID(),
      });

      const termReport = await inst.clientAs("accountant").rpc("finance_collection_report", {
        p_institution_id: inst.institutionId,
        p_academic_year_id: yearId,
        p_term_id: null,
        p_group_by: "term",
      });
      expect(termReport.error).toBeNull();
      const termRow = (termReport.data as Array<Record<string, unknown>>).find((r) => r.group_key === termId);
      expect(termRow).toBeTruthy();
      expect(Number(termRow?.billed)).toBe(4000);
      expect(Number(termRow?.collected)).toBe(0);
      expect(Number(termRow?.reversed)).toBe(4000);
      expect(Number(termRow?.outstanding)).toBe(4000);

      const gradeReport = await inst.clientAs("accountant").rpc("finance_collection_report", {
        p_institution_id: inst.institutionId,
        p_academic_year_id: yearId,
        p_term_id: null,
        p_group_by: "grade",
      });
      expect(gradeReport.error).toBeNull();
      const gradeRow = (gradeReport.data as Array<Record<string, unknown>>).find((r) => r.group_key === gradeId);
      expect(Number(gradeRow?.billed)).toBe(4000);
      expect(Number(gradeRow?.reversed)).toBe(4000);

      const modeReport = await inst.clientAs("accountant").rpc("finance_collection_report", {
        p_institution_id: inst.institutionId,
        p_academic_year_id: yearId,
        p_term_id: null,
        p_group_by: "mode",
      });
      expect(modeReport.error).toBeNull();
      const modeRow = (modeReport.data as Array<Record<string, unknown>>).find((r) => r.group_key === "cash");
      expect(modeRow?.billed).toBeNull();
      expect(Number(modeRow?.reversed)).toBe(4000);
      expect(Number(modeRow?.collected)).toBe(0);

      const badGroupBy = await inst.clientAs("accountant").rpc("finance_collection_report", {
        p_institution_id: inst.institutionId,
        p_academic_year_id: yearId,
        p_term_id: null,
        p_group_by: "student",
      });
      expect(badGroupBy.error?.message).toMatch(/validation_failed/i);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000074: notification_preferences 'finance' category", () => {
  it("accepts a preference row with category finance", async () => {
    const inst = await createTestInstitution("notif-pref-finance");
    try {
      const { error } = await inst.clientAs("owner").from("notification_preferences").insert({
        institution_id: inst.institutionId,
        user_id: inst.users.owner.id,
        category: "finance",
        channel: "sms",
        enabled: false,
      });
      expect(error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
