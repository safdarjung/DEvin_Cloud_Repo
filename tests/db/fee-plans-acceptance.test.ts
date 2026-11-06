// X04-T11 — fee-plans acceptance over HTTP (pattern: tests/db/timetable-
// acceptance.test.ts, tests/db/finance-completion-acceptance.test.ts).
// Exercises the real exported POST/GET route handlers end to end: accountant
// sets a late-fee rule (admin forbidden), sets an instalment plan (sum
// mismatch rejected), the nightly sweep + job handler charge the overdue
// part, a guardian reads the plan (another family's invoice is null),
// paying off the overdue part drops the invoice from defaulters, the Tally
// ledger export reflects both the receipt and the charges, and the module
// gate blocks `feePlans.instalments.set` when `fee_plans` is off.
import postgres from "postgres";
import Papa from "papaparse";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "@/modules/jobs/types";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
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

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const { lateFees } = await import("@/modules/jobs/handlers/fee_plans.late_fees");

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// --- HTTP dispatch helpers (same shape as finance-completion-acceptance.test.ts) ---

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

async function tokenFor(inst: TestInstitution, role: "accountant" | "admin" | "guardian"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// --- Fixture helpers (same shape as other X04 db test files) ---

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

function isoDaysFromNow(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Year + term + grade + one fee structure (principal = `amount`) + a student + a generated invoice, due 10 days ago. */
async function setupOverdueInvoice(
  institutionId: string,
  admissionNo: string,
  amount = 9000,
): Promise<{ yearId: string; termId: string; studentId: string; structureId: string; invoiceId: string }> {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId, { name: `2026-27-${admissionNo}` });
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId, { code: `G-${admissionNo}` });
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const studentId = await insertStudent(institutionId, admissionNo);
  await createFeeAssignment(institutionId, studentId, structureId, yearId);

  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  const invoiceId = row.id as string;
  await sql`update public.invoices set due_on = current_date - 10 where id = ${invoiceId}`;
  return { yearId, termId, studentId, structureId, invoiceId };
}

/** MOD's mechanism (same direct-settings-patch shape as finance-completion-acceptance.test.ts's module-off test). */
async function setModuleEnabledDirect(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}], ${sql.json(enabled)})
    where id = ${institutionId}
  `;
}

describe("X04 fee-plans acceptance over HTTP", () => {
  it(
    "accountant sets a late-fee rule (admin forbidden), sets an instalment plan (sum mismatch rejected), the " +
      "sweep + handler charge the overdue part, a guardian reads the plan (another family's invoice is null), " +
      "paying off the part drops it from defaulters, and the Tally export reflects the receipt and the charges",
    async () => {
      const inst = await createTestInstitution("fp-acceptance");
      createdInstitutions.push(inst);

      const { yearId, termId, studentId, structureId, invoiceId } = await setupOverdueInvoice(inst.institutionId, "ADM-FP-ACC-1");
      await linkGuardian(inst.institutionId, studentId);

      // A second, unplanned family's invoice in the same institution, to
      // prove getInstalments never leaks across families.
      const otherStudentId = await insertStudent(inst.institutionId, "ADM-FP-ACC-OTHER");
      await createFeeAssignment(inst.institutionId, otherStudentId, structureId, yearId);
      const [otherInvoiceRow] = await sql`select app.generate_invoice(${otherStudentId}::uuid, ${termId}::uuid) as id`;
      const otherInvoiceId = otherInvoiceRow.id as string;

      const accountantAuth = authHeader(await tokenFor(inst, "accountant"));
      const adminAuth = authHeader(await tokenFor(inst, "admin"));
      const guardianAuth = authHeader(await tokenFor(inst, "guardian"));

      // --- accountant sets a flat late-fee rule on the fixture structure ---
      const ruleRes = await dispatchAction(
        "feePlans.lateFeeRule.upsert",
        { institution: inst.slug, input: { feeStructureId: structureId, kind: "flat", amount: 200, graceDays: 0 } },
        accountantAuth,
      );
      expect(ruleRes.status).toBe(200);
      expect((await ruleRes.json()).ok).toBe(true);

      // --- admin cannot set the rule (not an `finance.plan.manage` holder) ---
      const ruleByAdminRes = await dispatchAction(
        "feePlans.lateFeeRule.upsert",
        { institution: inst.slug, input: { feeStructureId: structureId, kind: "flat", amount: 300, graceDays: 0 } },
        adminAuth,
      );
      expect(ruleByAdminRes.status).toBe(403);
      expect((await ruleByAdminRes.json()).error.code).toBe("forbidden");

      // --- accountant's instalment plan: sum mismatch rejected first ---
      const badPlanRes = await dispatchAction(
        "feePlans.instalments.set",
        {
          institution: inst.slug,
          input: {
            invoiceId,
            parts: [
              { dueOn: isoDaysFromNow(-10), amount: 3000 },
              { dueOn: isoDaysFromNow(20), amount: 3000 },
              { dueOn: isoDaysFromNow(40), amount: 2000 }, // 8000 total, principal is 9000
            ],
          },
        },
        accountantAuth,
      );
      expect(badPlanRes.status).toBe(422);
      const badPlanBody = await badPlanRes.json();
      expect(badPlanBody.error.code).toBe("validation_failed");
      expect(badPlanBody.error.fieldErrors?.parts).toBeTruthy();

      // --- correct plan: 3 parts summing to the principal, part 1 already overdue ---
      const planRes = await dispatchAction(
        "feePlans.instalments.set",
        {
          institution: inst.slug,
          input: {
            invoiceId,
            parts: [
              { dueOn: isoDaysFromNow(-10), amount: 3000 },
              { dueOn: isoDaysFromNow(20), amount: 3000 },
              { dueOn: isoDaysFromNow(40), amount: 3000 },
            ],
          },
        },
        accountantAuth,
      );
      expect(planRes.status).toBe(200);
      expect((await planRes.json()).ok).toBe(true);

      // --- nightly sweep enqueues the job; the real handler charges it ---
      await sql`select public.enqueue_due_late_fees()`;
      const jobs = (await sql`
        select id, institution_id, type, payload, idempotency_key, status, attempts, max_attempts,
               run_after, locked_at, locked_by, last_error, created_at, updated_at
        from public.jobs where institution_id = ${inst.institutionId} and type = 'fee_plans.late_fees'
      `) as unknown as JobRow[];
      expect(jobs).toHaveLength(1);
      await lateFees(jobs[0], { admin });

      const charges = await sql`select amount::numeric as amount from public.late_fee_charges where invoice_id = ${invoiceId}`;
      expect(charges).toHaveLength(1);
      expect(Number(charges[0].amount)).toBe(200);

      // --- guardian reads the plan: part 1 overdue + one late-fee row ---
      const instalmentsRes = await dispatchQuery("feePlans.instalments", inst.slug, { invoiceId }, guardianAuth);
      expect(instalmentsRes.status).toBe(200);
      const instalmentsBody = await instalmentsRes.json();
      expect(instalmentsBody.ok).toBe(true);
      expect(instalmentsBody.data.parts).toHaveLength(3);
      expect(instalmentsBody.data.parts[0]).toMatchObject({ seq: 1, status: "overdue", amount: 3000 });
      expect(instalmentsBody.data.lateFees).toHaveLength(1);
      expect(instalmentsBody.data.lateFees[0]).toMatchObject({ unitSeq: 1, amount: 200 });

      // --- another family's invoice is never leaked ---
      const otherRes = await dispatchQuery("feePlans.instalments", inst.slug, { invoiceId: otherInvoiceId }, guardianAuth);
      expect(otherRes.status).toBe(200);
      const otherBody = await otherRes.json();
      expect(otherBody.ok).toBe(true);
      expect(otherBody.data).toBeNull();

      // --- accountant pays off part 1 ---
      const payRes = await dispatchAction(
        "finance.payment.record",
        { institution: inst.slug, input: { invoiceId, amount: 3000, mode: "cash", receivedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() } },
        accountantAuth,
      );
      expect(payRes.status).toBe(200);
      expect((await payRes.json()).ok).toBe(true);

      const afterPayRes = await dispatchQuery("feePlans.instalments", inst.slug, { invoiceId }, accountantAuth);
      const afterPayBody = await afterPayRes.json();
      expect(afterPayBody.data.parts[0]).toMatchObject({ seq: 1, status: "paid" });

      // --- the invoice drops out of defaulters (no overdue part left) ---
      const defaultersRes = await dispatchQuery("finance.listDefaulters", inst.slug, { termId }, accountantAuth);
      expect(defaultersRes.status).toBe(200);
      const defaultersBody = await defaultersRes.json();
      expect(defaultersBody.ok).toBe(true);
      expect(defaultersBody.data.map((r: { invoiceId: string }) => r.invoiceId)).not.toContain(invoiceId);

      // --- Tally ledger export (CSV) reflects the receipt and the charges ---
      const csvRes = await dispatchQuery(
        "feePlans.ledgerExport",
        inst.slug,
        { from: "2026-04-01", to: "2027-03-31", layout: "tally", include: "all" },
        accountantAuth,
        "csv",
      );
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers.get("content-type")).toContain("text/csv");
      const csvText = await csvRes.text();
      const parsed = Papa.parse(csvText, { header: true });
      const rows = parsed.data as Array<Record<string, string>>;
      const voucherTypes = new Set(rows.map((r) => r["Voucher Type"]));
      expect(voucherTypes.has("Receipt")).toBe(true);
      expect(voucherTypes.has("Journal")).toBe(true);
      expect(rows.some((r) => r["Ledger Name"] === "Late Fee Income")).toBe(true);
    },
    20_000,
  );

  it("fee_plans disabled (MOD's mechanism) -> feePlans.instalments.set is forbidden; re-enabling restores access", async () => {
    // A dedicated, never-before-dispatched slug avoids getTenantContext()
    // cache() staleness (finance-completion-acceptance.test.ts's own note).
    const inst = await createTestInstitution("fp-module-off");
    createdInstitutions.push(inst);
    const { invoiceId } = await setupOverdueInvoice(inst.institutionId, "ADM-FP-OFF-1");
    await setModuleEnabledDirect(inst.institutionId, "fee_plans", false);
    const accountantAuth = authHeader(await tokenFor(inst, "accountant"));

    const disabledRes = await dispatchAction(
      "feePlans.instalments.set",
      {
        institution: inst.slug,
        input: {
          invoiceId,
          parts: [
            { dueOn: isoDaysFromNow(-10), amount: 4500 },
            { dueOn: isoDaysFromNow(20), amount: 4500 },
          ],
        },
      },
      accountantAuth,
    );
    expect(disabledRes.status).toBe(403);
    expect((await disabledRes.json()).error.code).toBe("forbidden");

    await setModuleEnabledDirect(inst.institutionId, "fee_plans", true);
    const reenabledRes = await dispatchAction(
      "feePlans.instalments.set",
      {
        institution: inst.slug,
        input: {
          invoiceId,
          parts: [
            { dueOn: isoDaysFromNow(-10), amount: 4500 },
            { dueOn: isoDaysFromNow(20), amount: 4500 },
          ],
        },
      },
      accountantAuth,
    );
    expect(reenabledRes.status).toBe(200);
    expect((await reenabledRes.json()).ok).toBe(true);
  }, 20_000);
});
