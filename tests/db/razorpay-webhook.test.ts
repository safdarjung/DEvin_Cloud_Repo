// M12-T12 — exercises the real exported `POST` handler of
// `src/app/api/public/payments/razorpay/route.ts` against the live
// Supabase instance (same pattern as tests/db/public-enquiry-route.test.ts),
// not a mock. The route's only DB access is through the service-role
// PostgREST client (07 §4, `payments_webhook` caller).
import { createHmac } from "node:crypto";
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
import { closeRolesHelper, createTestInstitution, type FixtureRole } from "../helpers/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

const WEBHOOK_SECRET = "test-razorpay-webhook-secret";
process.env.RAZORPAY_WEBHOOK_SECRET ??= WEBHOOK_SECRET;

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
  return { invoiceId: row.id as string };
}

function razorpayOrderId(): string {
  return "order_" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

/** Creates a `razorpay`-provider intent directly via the RPC (T11's action ships separately); amount is in rupees. */
async function createIntent(
  clientAs: (role: FixtureRole) => SupabaseClient,
  invoiceId: string,
  amount: number,
): Promise<{ orderId: string }> {
  const orderId = razorpayOrderId();
  const result = await clientAs("accountant").rpc("create_payment_intent", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_provider: "razorpay",
    p_provider_order_id: orderId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (result.error) throw new Error(result.error.message);
  return { orderId };
}

function sign(body: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function paymentCapturedBody(orderId: string, paymentId: string, amountPaise: number, event = "payment.captured"): string {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          status: "captured",
          amount: amountPaise,
          currency: "INR",
          method: "upi",
        },
      },
    },
  });
}

function webhookRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/public/payments/razorpay", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/public/payments/razorpay (06 rulings: Webhook, Modules)", () => {
  it("503 dependency_failed when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
    const previous = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      const { POST } = await import("@/app/api/public/payments/razorpay/route");
      const body = paymentCapturedBody("order_whatever123", "pay_whatever123", 100000);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.code).toBe("dependency_failed");
    } finally {
      if (previous === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = previous;
    }
  });

  it("413: a body over 64 KB is rejected before signature verification", async () => {
    const { POST } = await import("@/app/api/public/payments/razorpay/route");
    const oversized = "x".repeat(70 * 1024);
    const res = await POST(webhookRequest(oversized, { "content-length": String(Buffer.byteLength(oversized)) }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("validation_failed");
  });

  it("400 validation_failed on a forged signature; nothing written", async () => {
    const inst = await createTestInstitution("webhook-forged");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-1", 5000);
      const { orderId } = await createIntent(inst.clientAs, invoiceId, 2000);
      const { POST } = await import("@/app/api/public/payments/razorpay/route");

      const body = paymentCapturedBody(orderId, "pay_forged1", 200000);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body, "wrong-secret") }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_failed");

      const rows = await sql`select status from public.online_payment_intents where provider_order_id = ${orderId}`;
      expect(rows[0].status).toBe("created");
    } finally {
      await inst.cleanup();
    }
  });

  it("400 validation_failed when the signature header is missing", async () => {
    const { POST } = await import("@/app/api/public/payments/razorpay/route");
    const body = paymentCapturedBody("order_missingsig1", "pay_missingsig1", 100000);
    const res = await POST(webhookRequest(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("validation_failed");
  });

  it("200 ignored:event for an unhandled event type (refund.created)", async () => {
    const { POST } = await import("@/app/api/public/payments/razorpay/route");
    const body = JSON.stringify({
      event: "refund.created",
      payload: { payment: { entity: { id: "pay_x", order_id: "order_x", status: "captured", amount: 100, currency: "INR" } } },
    });
    const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.ignored).toBe("event");
  });

  it("404 not_found for an unknown order id", async () => {
    const { POST } = await import("@/app/api/public/payments/razorpay/route");
    const body = paymentCapturedBody("order_doesnotexist123", "pay_unknown1", 100000);
    const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("not_found");
  });

  it("happy path: payment.captured writes payment + ledger, marks intent paid, returns a receipt no", async () => {
    const inst = await createTestInstitution("webhook-happy");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-2", 5000);
      const { orderId } = await createIntent(inst.clientAs, invoiceId, 2000);
      const { POST } = await import("@/app/api/public/payments/razorpay/route");

      const paymentId = "pay_happy1";
      const body = paymentCapturedBody(orderId, paymentId, 200000);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.duplicate).toBe(false);
      expect(typeof json.data.receipt_no).toBe("string");

      const [intentRow] = await sql`select status, provider_payment_id, payment_id from public.online_payment_intents where provider_order_id = ${orderId}`;
      expect(intentRow.status).toBe("paid");
      expect(intentRow.provider_payment_id).toBe(paymentId);

      const payments = await sql`select mode, amount from public.payments where invoice_id = ${invoiceId}`;
      expect(payments).toHaveLength(1);
      expect(payments[0].mode).toBe("upi");
      expect(Number(payments[0].amount)).toBe(2000);

      const [ledgerDiff] = await sql`
        select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) as diff
        from public.ledger_entries where institution_id = ${inst.institutionId}
      `;
      expect(Number(ledgerDiff.diff)).toBe(0);

      // Identical replay -> duplicate: true, still exactly one payment row.
      const replayRes = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(replayRes.status).toBe(200);
      const replayJson = await replayRes.json();
      expect(replayJson.data.duplicate).toBe(true);
      const paymentsAfterReplay = await sql`select id from public.payments where invoice_id = ${invoiceId}`;
      expect(paymentsAfterReplay).toHaveLength(1);

      // order.paid for the same payment -> also duplicate.
      const orderPaidBody = paymentCapturedBody(orderId, paymentId, 200000, "order.paid");
      const orderPaidRes = await POST(webhookRequest(orderPaidBody, { "x-razorpay-signature": sign(orderPaidBody) }));
      expect(orderPaidRes.status).toBe(200);
      const orderPaidJson = await orderPaidRes.json();
      expect(orderPaidJson.data.duplicate).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("invoice paid between intent and capture → 200 unreconciled, no payment row, audit written; replay → duplicate", async () => {
    const inst = await createTestInstitution("webhook-unreconciled");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-4", 5000);
      const { orderId } = await createIntent(inst.clientAs, invoiceId, 2000);
      // Counter pays the whole invoice before the gateway capture arrives.
      const counter = await inst.clientAs("accountant").rpc("record_payment", {
        p_invoice_id: invoiceId, p_amount: 5000, p_mode: "cash", p_reference: null,
        p_received_at: new Date().toISOString(), p_idempotency_key: crypto.randomUUID(),
      });
      expect(counter.error).toBeNull();
      const { POST } = await import("@/app/api/public/payments/razorpay/route");

      const paymentId = "pay_unrec" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      const body = paymentCapturedBody(orderId, paymentId, 200000);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, data: { unreconciled: true, duplicate: false } });

      const [intentRow] = await sql`select status, provider_payment_id, payment_id from public.online_payment_intents where provider_order_id = ${orderId}`;
      expect(intentRow.status).toBe("unreconciled");
      expect(intentRow.provider_payment_id).toBe(paymentId);
      expect(intentRow.payment_id).toBeNull();

      const payments = await sql`select mode from public.payments where invoice_id = ${invoiceId}`;
      expect(payments.map((p) => p.mode)).toEqual(["cash"]);

      const audits = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'finance.payment.unreconciled'
      `;
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({
        order_id: orderId, provider_payment_id: paymentId, amount: 2000, reason: "invalid_state",
      });

      const replay = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ok: true, data: { unreconciled: true, duplicate: true } });
      const auditsAfter = await sql`
        select id from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'finance.payment.unreconciled'
      `;
      expect(auditsAfter).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a provider payment id replayed against a second order is 409 conflict, not 500", async () => {
    const inst = await createTestInstitution("webhook-payid-reuse");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-5", 5000);
      const first = await createIntent(inst.clientAs, invoiceId, 1000);
      const second = await createIntent(inst.clientAs, invoiceId, 1000);
      const { POST } = await import("@/app/api/public/payments/razorpay/route");

      const paymentId = "pay_reuse" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      const body1 = paymentCapturedBody(first.orderId, paymentId, 100000);
      expect((await POST(webhookRequest(body1, { "x-razorpay-signature": sign(body1) }))).status).toBe(200);

      const body2 = paymentCapturedBody(second.orderId, paymentId, 100000);
      const res = await POST(webhookRequest(body2, { "x-razorpay-signature": sign(body2) }));
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("400 validation_failed for a non-integer paise amount; nothing written", async () => {
    const inst = await createTestInstitution("webhook-fraction");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-6", 5000);
      const { orderId } = await createIntent(inst.clientAs, invoiceId, 2000);
      const { POST } = await import("@/app/api/public/payments/razorpay/route");

      const body = paymentCapturedBody(orderId, "pay_fraction1", 200000.5);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("validation_failed");
      const [intentRow] = await sql`select status from public.online_payment_intents where provider_order_id = ${orderId}`;
      expect(intentRow.status).toBe("created");
    } finally {
      await inst.cleanup();
    }
  });

  it("200 ignored:event for payment.captured in a currency other than INR", async () => {
    const { POST } = await import("@/app/api/public/payments/razorpay/route");
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_usd1", order_id: "order_usd123456", status: "captured", amount: 100, currency: "USD" } } },
    });
    const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.ignored).toBe("event");
  });

  it("200 ignored:module_disabled when online_payments is disabled for the institution; nothing written", async () => {
    const inst = await createTestInstitution("webhook-module-off");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-WH-3", 5000);
      const { orderId } = await createIntent(inst.clientAs, invoiceId, 2000);

      await sql`
        update public.institutions
        set settings = settings || '{"modules": {"online_payments": false}}'::jsonb
        where id = ${inst.institutionId}
      `;

      const { POST } = await import("@/app/api/public/payments/razorpay/route");
      const body = paymentCapturedBody(orderId, "pay_disabled1", 200000);
      const res = await POST(webhookRequest(body, { "x-razorpay-signature": sign(body) }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.ignored).toBe("module_disabled");

      const [intentRow] = await sql`select status from public.online_payment_intents where provider_order_id = ${orderId}`;
      expect(intentRow.status).toBe("created");
      const payments = await sql`select id from public.payments where invoice_id = ${invoiceId}`;
      expect(payments).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
