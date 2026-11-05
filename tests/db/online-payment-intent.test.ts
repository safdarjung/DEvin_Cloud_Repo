import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Opt-in mock (same shape as tests/db/payments.test.ts) — only this file's
// module graph gets it; every other db test file keeps the real module.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createPaymentIntent } from "@/modules/finance/online-payments.actions";
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

// M12-T11: finance.payment.createIntent — the TS action wrapping T5's
// public.create_payment_intent (tests/db/online-payments-rls.test.ts proves
// the SQL function directly). This file proves the action's own concerns:
// RLS-backed visibility (not_found before any gateway call), the permission
// gate, and the test-mode Razorpay order flow (gateway call count on
// replay, no intent row on a gateway failure) — none of which the SQL-only
// test can exercise since it calls the RPC directly.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

afterEach(() => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  vi.unstubAllGlobals();
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

/** Term + default fee structure (one tuition component) + a generated invoice for one student (same shape as tests/db/online-payments-rls.test.ts). */
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
  return { studentId, invoiceId: row.id as string };
}

/** A second open invoice (new student, same term/year) — direct insert, like tests/db/fee-reminders.test.ts. */
async function insertSiblingInvoice(institutionId: string, invoiceId: string): Promise<string> {
  const studentId = await insertStudent(institutionId, `ADM-SIB-${crypto.randomUUID().slice(0, 8)}`);
  const [row] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, concession_total, total, paid_total, due_on)
    select institution_id, ${studentId}, academic_year_id, term_id, ${`INV-${crypto.randomUUID().slice(0, 8)}`}, 'issued', 5000, 0, 5000, 0, due_on
    from public.invoices where id = ${invoiceId}
    returning id
  `;
  return row.id as string;
}

// Stubbing `globalThis.fetch` wholesale breaks every other network call in
// the process (supabase-js's own PostgREST/auth requests, used by `callAs`
// and by `createTestInstitution`'s fixture setup) — they'd all get routed
// through the Razorpay mock too, and a shared mocked Response body can only
// be read once. So this only intercepts the Razorpay orders URL and lets
// every other request fall through to the real fetch.
function stubRazorpayFetch(respond: () => Response): ReturnType<typeof vi.fn> {
  const realFetch = globalThis.fetch;
  const spy = vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.razorpay.com/")) return Promise.resolve(respond());
    return realFetch(input, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
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

describe("M12-T11: finance.payment.createIntent", () => {
  it("guardian creates a simulated intent for their own child's invoice", async () => {
    const inst = await createTestInstitution("intent-happy");
    try {
      const { invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-CI-1", 5000);
      await linkGuardian(inst.institutionId, studentId);

      const result = await callAs(inst, "guardian", createPaymentIntent, {
        invoiceId,
        amount: 2000,
        idempotencyKey: crypto.randomUUID(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.mode).toBe("simulated");
      expect(result.data.provider).toBe("simulated");
      expect(result.data.orderId).toMatch(/^sim_order_[a-f0-9]{32}$/);
      expect(result.data.amountPaise).toBe(200000);
      expect(result.data.currency).toBe("INR");
      expect(result.data.keyId).toBeNull();

      const [row] = await sql`select institution_id, invoice_id, status, provider from public.online_payment_intents where id = ${result.data.intentId}`;
      expect(row.institution_id).toBe(inst.institutionId);
      expect(row.invoice_id).toBe(invoiceId);
      expect(row.status).toBe("created");
      expect(row.provider).toBe("simulated");
    } finally {
      await inst.cleanup();
    }
  });

  it("another family's child invoice is not_found", async () => {
    const inst = await createTestInstitution("intent-other-family");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-2", 5000);
      // No guardian_students link for this institution's guardian -> not their child.

      const result = await callAs(inst, "guardian", createPaymentIntent, {
        invoiceId,
        amount: 1000,
        idempotencyKey: crypto.randomUUID(),
      });

      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher is forbidden", async () => {
    const inst = await createTestInstitution("intent-teacher");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-3", 5000);

      const result = await callAs(inst, "teacher", createPaymentIntent, {
        invoiceId,
        amount: 1000,
        idempotencyKey: crypto.randomUUID(),
      });

      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("amount greater than outstanding is validation_failed", async () => {
    const inst = await createTestInstitution("intent-amount");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-4", 5000);

      const result = await callAs(inst, "accountant", createPaymentIntent, {
        invoiceId,
        amount: 9999,
        idempotencyKey: crypto.randomUUID(),
      });

      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("an idempotency key already used for another invoice is conflict", async () => {
    const inst = await createTestInstitution("intent-key-reuse");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-8", 5000);
      const otherInvoiceId = await insertSiblingInvoice(inst.institutionId, invoiceId);
      const idempotencyKey = crypto.randomUUID();

      const first = await callAs(inst, "accountant", createPaymentIntent, { invoiceId, amount: 1000, idempotencyKey });
      expect(first.ok).toBe(true);
      const second = await callAs(inst, "accountant", createPaymentIntent, { invoiceId: otherInvoiceId, amount: 1000, idempotencyKey });
      expect(second).toMatchObject({ ok: false, error: { code: "conflict" } });
    } finally {
      await inst.cleanup();
    }
  });

  describe("test mode (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET + fetch stubbed)", () => {
    it("replaying the same idempotency key returns the same intent with exactly one gateway call", async () => {
      // Fixture setup first, real network calls (createTestInstitution's own
      // supabase-admin auth calls) — global fetch is only stubbed around the
      // action calls below, never around fixture setup/teardown.
      const inst = await createTestInstitution("intent-replay");
      try {
        const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-5", 5000);
        const idempotencyKey = crypto.randomUUID();

        process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
        process.env.RAZORPAY_KEY_SECRET = "topsecret";
        const fetchSpy = stubRazorpayFetch(() => Response.json({ id: "order_ABC123XYZ999" }));

        const first = await callAs(inst, "accountant", createPaymentIntent, { invoiceId, amount: 1000, idempotencyKey });
        expect(first.ok).toBe(true);
        const second = await callAs(inst, "accountant", createPaymentIntent, { invoiceId, amount: 1000, idempotencyKey });
        expect(second.ok).toBe(true);

        if (first.ok && second.ok) {
          expect(second.data.intentId).toBe(first.data.intentId);
          expect(second.data.orderId).toBe(first.data.orderId);
          expect(second.data.mode).toBe("test");
          expect(second.data.keyId).toBe("rzp_test_abc123");
        }
        const razorpayCalls = fetchSpy.mock.calls.filter(([input]) => String(input).startsWith("https://api.razorpay.com/"));
        expect(razorpayCalls).toHaveLength(1);

        const count = await sql`select count(*)::int as n from public.online_payment_intents where invoice_id = ${invoiceId}`;
        expect(count[0]?.n).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        await inst.cleanup();
      }
    });

    it.each([
      { label: "amount over outstanding is validation_failed", amount: 9999, payFirst: false, code: "validation_failed" },
      { label: "a fully paid invoice is invalid_state", amount: 1000, payFirst: true, code: "invalid_state" },
    ])("$label before any gateway call", async ({ amount, payFirst, code }) => {
      const inst = await createTestInstitution("intent-precheck");
      try {
        const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-7", 5000);
        if (payFirst) {
          await sql`select app.record_payment(${invoiceId}::uuid, 5000, 'cash', null, now(), ${crypto.randomUUID()})`;
        }

        process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
        process.env.RAZORPAY_KEY_SECRET = "topsecret";
        const fetchSpy = stubRazorpayFetch(() => Response.json({ id: "order_ABC123XYZ999" }));

        const result = await callAs(inst, "accountant", createPaymentIntent, { invoiceId, amount, idempotencyKey: crypto.randomUUID() });
        expect(result).toMatchObject({ ok: false, error: { code } });
        const razorpayCalls = fetchSpy.mock.calls.filter(([input]) => String(input).startsWith("https://api.razorpay.com/"));
        expect(razorpayCalls).toHaveLength(0);
      } finally {
        vi.unstubAllGlobals();
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        await inst.cleanup();
      }
    });

    it("a gateway failure leaves no intent row", async () => {
      const inst = await createTestInstitution("intent-gateway-fail");
      try {
        const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-CI-6", 5000);

        process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
        process.env.RAZORPAY_KEY_SECRET = "topsecret";
        stubRazorpayFetch(() => new Response("gateway down", { status: 500 }));

        const result = await callAs(inst, "accountant", createPaymentIntent, {
          invoiceId,
          amount: 1000,
          idempotencyKey: crypto.randomUUID(),
        });

        expect(result).toMatchObject({ ok: false, error: { code: "dependency_failed" } });

        const rows = await sql`select id from public.online_payment_intents where invoice_id = ${invoiceId}`;
        expect(rows).toHaveLength(0);
      } finally {
        vi.unstubAllGlobals();
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        await inst.cleanup();
      }
    });
  });
});
