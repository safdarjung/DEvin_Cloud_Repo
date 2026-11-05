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
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// Migration 20261028000083 (M12-T5): online_payment_intents +
// public.create_payment_intent / public.record_online_payment. Direct
// RPC/table tests (action + webhook ship in T11/T12) — same shape as
// tests/db/finance-plus-rls.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

// service_role client — the only role granted execute on
// public.record_online_payment. Real PostgREST RPC, not the raw `sql` admin
// connection: that connection is a Postgres superuser and bypasses EXECUTE
// grants entirely, which would prove nothing about authenticated access.
function serviceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

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

async function linkGuardian(institutionId: string, studentId: string): Promise<void> {
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true)
  `;
}

function simOrderId(): string {
  return "sim_order_" + crypto.randomUUID().replace(/-/g, "");
}

describe("migration 20261028000083: public.create_payment_intent", () => {
  it("guardian creates a simulated intent for their own child's invoice", async () => {
    const inst = await createTestInstitution("intent-guardian");
    try {
      const { invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-INT-1", 5000);
      await linkGuardian(inst.institutionId, studentId);

      const result = await inst.clientAs("guardian").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 2000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();

      const [row] = await sql`select institution_id, invoice_id, amount, status from public.online_payment_intents where id = ${result.data as string}`;
      expect(row.institution_id).toBe(inst.institutionId);
      expect(row.invoice_id).toBe(invoiceId);
      expect(Number(row.amount)).toBe(2000);
      expect(row.status).toBe("created");
    } finally {
      await inst.cleanup();
    }
  });

  it("another family's invoice and a teacher both get not_found", async () => {
    const inst = await createTestInstitution("intent-scope");
    try {
      const { invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-INT-2", 5000);
      // No guardian_students link for this guardian -> not their child.
      void studentId;

      const guardianResult = await inst.clientAs("guardian").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(guardianResult.error?.message).toMatch(/not_found/i);

      const teacherResult = await inst.clientAs("teacher").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(teacherResult.error?.message).toMatch(/not_found/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("amount greater than outstanding is validation_failed", async () => {
    const inst = await createTestInstitution("intent-amount");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-3", 5000);

      const result = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 9999,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error?.message).toMatch(/validation_failed/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("a fully paid invoice is invalid_state", async () => {
    const inst = await createTestInstitution("intent-paid");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-4", 3000);
      const payment = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId, p_amount: 3000, p_mode: "cash", p_reference: null,
        p_received_at: new Date().toISOString(), p_idempotency_key: crypto.randomUUID(),
      });
      expect(payment.error).toBeNull();

      const result = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 500,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error?.message).toMatch(/invalid_state/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("replaying the same idempotency key returns the same intent id", async () => {
    const inst = await createTestInstitution("intent-idempotent");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-5", 5000);
      const key = crypto.randomUUID();

      const first = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: key,
      });
      expect(first.error).toBeNull();

      const replay = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: key,
      });
      expect(replay.error).toBeNull();
      expect(replay.data).toBe(first.data);

      const count = await sql`select count(*)::int as n from public.online_payment_intents where invoice_id = ${invoiceId}`;
      expect(count[0]?.n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("an idempotency key already used for another invoice is conflict", async () => {
    const inst = await createTestInstitution("intent-key-reuse-rpc");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-KR", 5000);
      const studentId = await insertStudent(inst.institutionId, "ADM-INT-KR2");
      const [other] = await sql`
        insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, concession_total, total, paid_total, due_on)
        select institution_id, ${studentId}, academic_year_id, term_id, 'INV-KR-2', 'issued', 5000, 0, 5000, 0, due_on
        from public.invoices where id = ${invoiceId}
        returning id
      `;
      const key = crypto.randomUUID();
      const call = (id: string) =>
        inst.clientAs("accountant").rpc("create_payment_intent", {
          p_invoice_id: id, p_amount: 1000, p_provider: "simulated", p_provider_order_id: simOrderId(), p_idempotency_key: key,
        });

      expect((await call(invoiceId)).error).toBeNull();
      const reuse = await call(other.id as string);
      expect(reuse.error?.message).toBe("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("a malformed order id is validation_failed", async () => {
    const inst = await createTestInstitution("intent-bad-order");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-6", 5000);

      const result = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "razorpay",
        p_provider_order_id: "not-a-valid-order-id",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(result.error?.message).toMatch(/validation_failed/i);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000083: public.record_online_payment", () => {
  it("authenticated cannot execute record_online_payment", async () => {
    const inst = await createTestInstitution("intent-grants");
    try {
      const result = await inst.clientAs("accountant").rpc("record_online_payment", {
        p_order_id: "sim_order_whatever",
        p_provider_payment_id: "pay_whatever",
        p_amount_paise: 100000,
        p_method: "upi",
      });
      expect(result.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("service role records a payment: receipt, ledger Dr bank/Cr fees_receivable, intent paid; replay is idempotent; unknown order is not_found", async () => {
    const inst = await createTestInstitution("intent-record");
    const admin = serviceRoleClient();
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-7", 5000);

      const unknown = await admin.rpc("record_online_payment", {
        p_order_id: "sim_order_does_not_exist",
        p_provider_payment_id: "pay_1",
        p_amount_paise: 100000,
        p_method: "upi",
      });
      expect(unknown.error?.message).toMatch(/not_found/i);

      const orderId = simOrderId();
      const intent = await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: orderId,
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(intent.error).toBeNull();
      const intentId = intent.data as string;

      const payId = "pay_" + crypto.randomUUID().replace(/-/g, "");
      const record = await admin.rpc("record_online_payment", {
        p_order_id: orderId,
        p_provider_payment_id: payId,
        p_amount_paise: 100000,
        p_method: "upi",
      });
      expect(record.error).toBeNull();
      const recorded = record.data as { payment_id: string; receipt_id: string; receipt_no: string; duplicate: boolean };
      expect(recorded.duplicate).toBe(false);
      expect(recorded.payment_id).toBeTruthy();

      const [intentRow] = await sql`select status, payment_id, provider_payment_id from public.online_payment_intents where id = ${intentId}`;
      expect(intentRow.status).toBe("paid");
      expect(intentRow.payment_id).toBe(recorded.payment_id);
      expect(intentRow.provider_payment_id).toBe(payId);

      const debitRows = await sql`
        select account from public.ledger_entries where payment_id = ${recorded.payment_id} and debit > 0
      `;
      expect(debitRows).toHaveLength(1);
      expect(debitRows[0]?.account).toBe("bank");
      const creditRows = await sql`
        select account from public.ledger_entries where payment_id = ${recorded.payment_id} and credit > 0
      `;
      expect(creditRows).toHaveLength(1);
      expect(creditRows[0]?.account).toBe("fees_receivable");

      // Replay with the same provider_payment_id -> duplicate, no second payment.
      const replay = await admin.rpc("record_online_payment", {
        p_order_id: orderId,
        p_provider_payment_id: payId,
        p_amount_paise: 100000,
        p_method: "upi",
      });
      expect(replay.error).toBeNull();
      expect((replay.data as { duplicate: boolean }).duplicate).toBe(true);
      expect((replay.data as { payment_id: string }).payment_id).toBe(recorded.payment_id);

      const paymentCount = await sql`select count(*)::int as n from public.payments where invoice_id = ${invoiceId}`;
      expect(paymentCount[0]?.n).toBe(1);

      // A different payment id on an already-paid intent is a conflict.
      const conflict = await admin.rpc("record_online_payment", {
        p_order_id: orderId,
        p_provider_payment_id: "pay_" + crypto.randomUUID().replace(/-/g, ""),
        p_amount_paise: 100000,
        p_method: "upi",
      });
      expect(conflict.error?.message).toMatch(/conflict/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("a paise amount that does not match the intent is validation_failed", async () => {
    const inst = await createTestInstitution("intent-paise");
    const admin = serviceRoleClient();
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-INT-8", 5000);
      const orderId = simOrderId();
      await inst.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: orderId,
        p_idempotency_key: crypto.randomUUID(),
      });

      const result = await admin.rpc("record_online_payment", {
        p_order_id: orderId,
        p_provider_payment_id: "pay_" + crypto.randomUUID().replace(/-/g, ""),
        p_amount_paise: 50000, // intent is 1000 rupees = 100000 paise
        p_method: "card",
      });
      expect(result.error?.message).toMatch(/validation_failed/i);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("migration 20261028000083: online_payment_intents RLS", () => {
  it("guardian reads own child's intents only; a direct UPDATE changes nothing", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const { invoiceId, studentId } = await setupInvoice(instA.institutionId, "ADM-INT-RLS");
      await linkGuardian(instA.institutionId, studentId);

      const intent = await instA.clientAs("accountant").rpc("create_payment_intent", {
        p_invoice_id: invoiceId,
        p_amount: 1000,
        p_provider: "simulated",
        p_provider_order_id: simOrderId(),
        p_idempotency_key: crypto.randomUUID(),
      });
      const intentId = intent.data as string;

      const { data: guardianRows } = await instA.clientAs("guardian").from("online_payment_intents").select("id");
      expect(guardianRows).toHaveLength(1);
      expect(guardianRows?.[0]?.id).toBe(intentId);

      const { data: otherRows, error: otherError } = await instB.clientAs("guardian").from("online_payment_intents").select("id");
      expect(otherError).toBeNull();
      expect(otherRows).toHaveLength(0);

      const { data: updated, error: updateError } = await instA
        .clientAs("guardian")
        .from("online_payment_intents")
        .update({ status: "paid" })
        .eq("id", intentId)
        .select();
      expect(updateError).toBeNull();
      expect(updated).toHaveLength(0);

      const [row] = await sql`select status from public.online_payment_intents where id = ${intentId}`;
      expect(row.status).toBe("created");
    });
  });
});
