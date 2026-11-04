// M12-T13 — finance completion acceptance over HTTP (pattern:
// tests/db/timetable-acceptance.test.ts). Exercises the real exported
// POST/GET route handlers, not direct function calls: accountant records a
// payment, is forbidden from voiding it, principal voids it, accountant
// re-records, the ledger stays balanced, the module gate blocks
// finance_plus actions when MOD disables it, a guardian buys an online
// intent (test mode, fetch stubbed) and pays it off through the signed
// webhook (forged rejected, replay idempotent), the collection report CSV
// reflects the void, and a reminder job is enqueued.
//
// Also covers finance.collectionReport behaviours T9 left untested:
// teacher forbidden, another institution's term, grade grouping.
import { createHmac } from "node:crypto";
import postgres from "postgres";
import Papa from "papaparse";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { POST as webhookPost } from "@/app/api/public/payments/razorpay/route";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

afterEach(() => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  vi.unstubAllGlobals();
});

// --- HTTP dispatch helpers (same shape as timetable-acceptance.test.ts) ---

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown, format?: string): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  if (format) url.searchParams.set("format", format);
  return url;
}

function dispatchQuery(
  name: string,
  institution: string,
  input: unknown,
  headers: Record<string, string>,
  format?: string,
): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input, format), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// --- Fixture helpers (same shape as tests/db/finance-void.test.ts) ---

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
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardian(institutionId: string, studentId: string): Promise<void> {
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true, true)
  `;
}

/** Year + term + grade + a single fee structure/component + a student + a generated invoice. */
async function setupInvoice(
  institutionId: string,
  admissionNo: string,
  amount = 10000,
): Promise<{ yearId: string; termId: string; studentId: string; invoiceId: string }> {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const studentId = await insertStudent(institutionId, admissionNo);
  await createFeeAssignment(institutionId, studentId, structureId, yearId);

  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  return { yearId, termId, studentId, invoiceId: row.id as string };
}

/** MOD's mechanism (same direct-settings-patch shape as T12's own "module disabled" test). */
async function setModuleEnabledDirect(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}], ${sql.json(enabled)})
    where id = ${institutionId}
  `;
}

function razorpayOrderId(): string {
  return "order_ACCEPTANCE" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Intercepts only the Razorpay orders URL so supabase-js's own fetch calls still go through (same shape as tests/db/online-payment-intent.test.ts). */
function stubRazorpayFetch(orderId: string): void {
  const realFetch = globalThis.fetch;
  const spy = vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.razorpay.com/")) return Promise.resolve(Response.json({ id: orderId }));
    return realFetch(input, init);
  });
  vi.stubGlobal("fetch", spy);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function paymentCapturedBody(orderId: string, paymentId: string, amountPaise: number, event = "payment.captured"): string {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: { id: paymentId, order_id: orderId, status: "captured", amount: amountPaise, currency: "INR", method: "upi" },
      },
    },
  });
}

function webhookRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/public/payments/razorpay", { method: "POST", headers, body });
}

describe("M12 finance completion acceptance over HTTP", () => {
  it(
    "accountant records a payment, is forbidden from voiding it, principal voids it, accountant re-records, " +
      "the ledger stays balanced, finance_plus gates the void action, a guardian pays online through the " +
      "signed webhook (forged rejected, replay idempotent), the collection report CSV reflects the void, and " +
      "a reminder job is enqueued",
    async () => {
      const WEBHOOK_SECRET = "acceptance-webhook-secret";
      const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

      const inst = await createTestInstitution("finance-completion-acceptance");
      try {
        const { yearId, termId, invoiceId, studentId } = await setupInvoice(inst.institutionId, "ADM-FIN-ACC-1", 10000);
        await linkGuardian(inst.institutionId, studentId);

        const accountantAuth = authHeader(await tokenFor(inst, "accountant"));
        const principalAuth = authHeader(await tokenFor(inst, "principal"));
        const guardianAuth = authHeader(await tokenFor(inst, "guardian"));

        // --- accountant records a cash payment (partial: 3000 of 10000) ---
        const recordRes = await dispatchAction(
          "finance.payment.record",
          { institution: inst.slug, input: { invoiceId, amount: 3000, mode: "cash", receivedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() } },
          accountantAuth,
        );
        expect(recordRes.status).toBe(200);
        const recordBody = await recordRes.json();
        expect(recordBody.ok).toBe(true);
        const paymentId = recordBody.data.paymentId as string;

        // --- accountant cannot void (07 §2.2: owner/principal only) ---
        const voidByAccountantRes = await dispatchAction(
          "finance.payment.void",
          { institution: inst.slug, input: { paymentId, kind: "void", reason: "Accountant should not be able to void.", idempotencyKey: crypto.randomUUID() } },
          accountantAuth,
        );
        expect(voidByAccountantRes.status).toBe(403);
        const voidByAccountantBody = await voidByAccountantRes.json();
        expect(voidByAccountantBody.error.code).toBe("forbidden");

        // --- principal voids it ---
        const voidRes = await dispatchAction(
          "finance.payment.void",
          { institution: inst.slug, input: { paymentId, kind: "void", reason: "Wrong amount entered at the counter.", idempotencyKey: crypto.randomUUID() } },
          principalAuth,
        );
        expect(voidRes.status).toBe(200);
        const voidBody = await voidRes.json();
        expect(voidBody.ok).toBe(true);
        expect(voidBody.data.invoiceStatus).toBe("issued");
        expect(voidBody.data.paidTotal).toBe(0);

        // --- accountant re-records the same amount ---
        const reRecordRes = await dispatchAction(
          "finance.payment.record",
          { institution: inst.slug, input: { invoiceId, amount: 3000, mode: "cash", receivedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() } },
          accountantAuth,
        );
        expect(reRecordRes.status).toBe(200);
        const reRecordBody = await reRecordRes.json();
        expect(reRecordBody.ok).toBe(true);

        // --- ledger stays balanced ---
        const ledgerRes = await dispatchQuery(
          "finance.listLedgerEntries",
          inst.slug,
          { from: "2026-04-01", to: "2027-03-31" },
          accountantAuth,
        );
        expect(ledgerRes.status).toBe(200);
        const ledgerBody = await ledgerRes.json();
        expect(ledgerBody.ok).toBe(true);
        expect(ledgerBody.data.balanced).toBe(true);

        // Module-disabled -> forbidden is covered in its own test below with
        // its own institution: getTenantContext() is wrapped in React's
        // cache() (04 §4), which memoizes per institution slug for the
        // process's lifetime outside a real Next.js request — toggling the
        // module on this same already-dispatched slug would not be seen by
        // a later dispatchAction call on it.

        // --- guardian buys an online intent (test mode, fetch stubbed) ---
        process.env.RAZORPAY_KEY_ID = "rzp_test_acceptance";
        process.env.RAZORPAY_KEY_SECRET = "topsecret";
        const orderId = razorpayOrderId();
        stubRazorpayFetch(orderId);

        const intentRes = await dispatchAction(
          "finance.payment.createIntent",
          { institution: inst.slug, input: { invoiceId, amount: 2000, idempotencyKey: crypto.randomUUID() } },
          guardianAuth,
        );
        vi.unstubAllGlobals();
        expect(intentRes.status).toBe(200);
        const intentBody = await intentRes.json();
        expect(intentBody.ok).toBe(true);
        expect(intentBody.data.mode).toBe("test");
        expect(intentBody.data.provider).toBe("razorpay");
        expect(intentBody.data.orderId).toBe(orderId);
        expect(intentBody.data.keyId).toBe("rzp_test_acceptance");

        // --- forged webhook signature: rejected, nothing written ---
        const paymentId2 = "pay_acceptance1";
        const capturedBody = paymentCapturedBody(orderId, paymentId2, 200000);
        const forgedRes = await webhookPost(webhookRequest(capturedBody, { "x-razorpay-signature": sign(capturedBody, "wrong-secret") }));
        expect(forgedRes.status).toBe(400);
        const forgedBody = await forgedRes.json();
        expect(forgedBody.error.code).toBe("validation_failed");
        const [intentBeforeCapture] = await sql`select status from public.online_payment_intents where provider_order_id = ${orderId}`;
        expect(intentBeforeCapture.status).toBe("created");

        // --- correctly signed webhook: 200, receipt issued ---
        const capturedRes = await webhookPost(webhookRequest(capturedBody, { "x-razorpay-signature": sign(capturedBody, WEBHOOK_SECRET) }));
        expect(capturedRes.status).toBe(200);
        const capturedResBody = await capturedRes.json();
        expect(capturedResBody.ok).toBe(true);
        expect(capturedResBody.data.duplicate).toBe(false);
        expect(typeof capturedResBody.data.receipt_no).toBe("string");

        // --- replay: idempotent, still exactly one online payment ---
        const replayRes = await webhookPost(webhookRequest(capturedBody, { "x-razorpay-signature": sign(capturedBody, WEBHOOK_SECRET) }));
        expect(replayRes.status).toBe(200);
        const replayBody = await replayRes.json();
        expect(replayBody.data.duplicate).toBe(true);
        const onlinePayments = await sql`select id from public.payments where invoice_id = ${invoiceId} and reference like 'razorpay %'`;
        expect(onlinePayments).toHaveLength(1);

        // --- collection report (CSV) reflects the void ---
        const csvRes = await dispatchQuery(
          "finance.collectionReport",
          inst.slug,
          { groupBy: "term", academicYearId: yearId, termId },
          accountantAuth,
          "csv",
        );
        expect(csvRes.status).toBe(200);
        expect(csvRes.headers.get("content-type")).toContain("text/csv");
        const csvText = await csvRes.text();
        const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true });
        const rows = parsed.data as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.invoiceCount).toBe(1);
        expect(row.billed).toBe(10000);
        // collected = invoice.paid_total (net of reversal): 3000 (re-recorded cash) + 2000 (online) = 5000.
        expect(row.collected).toBe(5000);
        // reversed = the voided payment's amount.
        expect(row.reversed).toBe(3000);
        expect(row.outstanding).toBe(5000);

        // --- reminders.send ---
        const remindersRes = await dispatchAction("finance.reminders.send", { institution: inst.slug, input: { termId } }, accountantAuth);
        expect(remindersRes.status).toBe(200);
        const remindersBody = await remindersRes.json();
        expect(remindersBody.ok).toBe(true);
        expect(typeof remindersBody.data.jobId).toBe("string");
        expect(remindersBody.data.jobId.length).toBeGreaterThan(0);
      } finally {
        if (previousSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
        else process.env.RAZORPAY_WEBHOOK_SECRET = previousSecret;
        await inst.cleanup();
      }
    },
  );

  it("finance_plus disabled (MOD's mechanism) -> finance.payment.void is forbidden, module error not role error", async () => {
    // A dedicated, never-before-dispatched institution slug: disabling the
    // module before this slug's very first HTTP call avoids the
    // getTenantContext() cache() staleness noted above. The module check
    // runs before the handler ever touches the payment, so a well-formed
    // but non-existent paymentId still proves the gate.
    const inst = await createTestInstitution("finance-completion-module-off");
    try {
      await setModuleEnabledDirect(inst.institutionId, "finance_plus", false);
      const principalAuth = authHeader(await tokenFor(inst, "principal"));

      const res = await dispatchAction(
        "finance.payment.void",
        { institution: inst.slug, input: { paymentId: crypto.randomUUID(), kind: "void", reason: "Should be blocked by the module gate.", idempotencyKey: crypto.randomUUID() } },
        principalAuth,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("finance.collectionReport — behaviours T9 left untested", () => {
  it("teacher is forbidden", async () => {
    const inst = await createTestInstitution("collection-report-teacher");
    try {
      const { yearId } = await setupInvoice(inst.institutionId, "ADM-CR-TEACHER");
      const teacherAuth = authHeader(await tokenFor(inst, "teacher"));

      const res = await dispatchQuery("finance.collectionReport", inst.slug, { groupBy: "term", academicYearId: yearId }, teacherAuth);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("another institution's term never returns that institution's rows (not_found/validation_failed, never leaked data)", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      await setupInvoice(instA.institutionId, "ADM-CR-A");
      const { termId: termIdB } = await setupInvoice(instB.institutionId, "ADM-CR-B");
      const principalAuthA = authHeader(await tokenFor(instA, "principal"));

      const res = await dispatchQuery(
        "finance.collectionReport",
        instA.slug,
        { groupBy: "term", termId: termIdB },
        principalAuthA,
      );
      const body = await res.json();
      if (body.ok) {
        // Never a leak of institution B's term row under institution A's call.
        expect(body.data).toEqual([]);
      } else {
        expect(["not_found", "validation_failed"]).toContain(body.error.code);
      }
    });
  });

  it("groups by grade, ordered by grade sort order", async () => {
    const inst = await createTestInstitution("collection-report-grade");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });

      const gradeV = await createGrade(inst.institutionId, { code: "V", displayName: "Grade V", sortKey: 5 });
      const gradeVI = await createGrade(inst.institutionId, { code: "VI", displayName: "Grade VI", sortKey: 6 });

      const structureV = await createFeeStructure(inst.institutionId, yearId, gradeV);
      await createFeeComponent(inst.institutionId, structureV, { head: "tuition", amount: 5000, frequency: "term" });
      const structureVI = await createFeeStructure(inst.institutionId, yearId, gradeVI);
      await createFeeComponent(inst.institutionId, structureVI, { head: "tuition", amount: 8000, frequency: "term" });

      const studentV = await insertStudent(inst.institutionId, "ADM-CR-GRADE-V");
      await createFeeAssignment(inst.institutionId, studentV, structureV, yearId);
      await sql`select app.generate_invoice(${studentV}::uuid, ${termId}::uuid) as id`;

      const studentVI = await insertStudent(inst.institutionId, "ADM-CR-GRADE-VI");
      await createFeeAssignment(inst.institutionId, studentVI, structureVI, yearId);
      const [invVI] = await sql`select app.generate_invoice(${studentVI}::uuid, ${termId}::uuid) as id`;

      const accountantAuth = authHeader(await tokenFor(inst, "accountant"));

      // Grade VI's invoice is paid in full; grade V's is untouched.
      const payRes = await dispatchAction(
        "finance.payment.record",
        { institution: inst.slug, input: { invoiceId: invVI.id, amount: 8000, mode: "cash", receivedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() } },
        accountantAuth,
      );
      expect(payRes.status).toBe(200);

      const res = await dispatchQuery("finance.collectionReport", inst.slug, { groupBy: "grade", academicYearId: yearId }, accountantAuth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data.map((r: { groupLabel: string }) => r.groupLabel)).toEqual(["Grade V", "Grade VI"]);

      const [rowV, rowVI] = body.data;
      expect(rowV.billed).toBe(5000);
      expect(rowV.collected).toBe(0);
      expect(rowVI.billed).toBe(8000);
      expect(rowVI.collected).toBe(8000);
    } finally {
      await inst.cleanup();
    }
  });
});
