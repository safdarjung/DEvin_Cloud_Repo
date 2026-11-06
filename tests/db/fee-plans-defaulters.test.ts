import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Opt-in mock (same shape as tests/db/finance-collection-report.test.ts) —
// only this file's module graph gets it; `listDefaulters` calls
// `createClient()` from `@/lib/supabase/server`.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { listDefaulters } from "@/modules/finance/queries";
import { feeReminder } from "@/modules/jobs/handlers/finance.fee_reminder";
import { buildContext, closeActionsHelper } from "../helpers/actions";
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
import { setActingClient } from "../helpers/server-client-mock";

// X04-T9 — ruling "Defaulters respect instalments": `listDefaulters` drops
// plan invoices with no `overdue` part and, for kept plan invoices, uses
// the earliest unpaid part's `due_on`; `finance.fee_reminder` (M12) skips
// the same invoices via the same RPC. Both read live, so this proves the
// behaviour is unaffected by the `fee_plans` module flag (rulings "Module":
// existing plans still shape defaulters/reminders while the module is off).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

// Same shape as tests/db/finance-collection-report.test.ts's setFinanceSettings.
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

/** Fixture: one term, one 10000-rupee tuition structure, 3 invoices — a
 * no-plan unpaid invoice (A), a plan invoice whose only overdue-shaped
 * part is now paid (B, not a defaulter), and a plan invoice with an
 * overdue part (C, a defaulter). due_on math: term starts_on 2026-04-01 +
 * default_due_day 10 = invoice due_on 2026-04-11 (months in the past —
 * "today" is 2026-11-05 per the environment this packet runs in). All 3
 * students share one guardian (the fixture's own) as primary, active
 * member, so `finance.fee_reminder` has a recipient for every invoice. */
async function buildFixture(inst: TestInstitution): Promise<{
  termId: string;
  invoiceA: string;
  invoiceB: string;
  invoiceC: string;
  guardianId: string;
}> {
  await setFinanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });

  const [membership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  const guardianId = membership.guardian_id as string;

  async function studentInvoice(admissionNo: string): Promise<string> {
    const studentId = await insertStudent(inst.institutionId, admissionNo);
    await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
    `;
    const { data, error } = await inst.clientAs("accountant").rpc("generate_invoice", {
      p_student_id: studentId,
      p_term_id: termId,
    });
    if (error) throw error;
    return data as string;
  }

  const invoiceA = await studentInvoice("ADM-FPD-A");
  const invoiceB = await studentInvoice("ADM-FPD-B");
  const invoiceC = await studentInvoice("ADM-FPD-C");

  // B: part 1 (due 2026-05-01, in the past) fully paid; part 2 (due
  // 2026-12-01, in the future) unpaid -> no overdue part.
  const setB = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
    p_invoice_id: invoiceB,
    p_parts: [
      { due_on: "2026-05-01", amount: 6000 },
      { due_on: "2026-12-01", amount: 4000 },
    ],
  });
  if (setB.error) throw setB.error;
  const payB = await inst.clientAs("accountant").rpc("record_payment", {
    p_invoice_id: invoiceB,
    p_amount: 6000,
    p_mode: "cash",
    p_reference: null,
    p_received_at: new Date().toISOString(),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (payB.error) throw payB.error;

  // C: part 1 (due 2026-05-01, in the past) unpaid -> overdue; part 2
  // (due 2026-12-01) unpaid, in the future.
  const setC = await inst.clientAs("accountant").rpc("set_invoice_instalments", {
    p_invoice_id: invoiceC,
    p_parts: [
      { due_on: "2026-05-01", amount: 6000 },
      { due_on: "2026-12-01", amount: 4000 },
    ],
  });
  if (setC.error) throw setC.error;

  return { termId, invoiceA, invoiceB, invoiceC, guardianId };
}

function makeJob(institutionId: string, termId: string, asOf: string, idempotencyKey: string) {
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "finance.fee_reminder" as const,
    payload: { term_id: termId, as_of: asOf },
    idempotency_key: idempotencyKey,
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

describe("listDefaulters respects instalment plans (X04-T9)", () => {
  it("drops a plan invoice with no overdue part, keeps the no-plan invoice and the plan invoice with an overdue part (dueOn = that part)", async () => {
    const inst = await createTestInstitution("fpd-list");
    createdInstitutions.push(inst);
    const { termId, invoiceA, invoiceB, invoiceC } = await buildFixture(inst);

    const ctx = await buildContext(inst, "accountant");
    setActingClient(inst.clientAs("accountant"));
    let rows;
    try {
      rows = await listDefaulters(ctx, { termId });
    } finally {
      setActingClient(null);
    }

    const byInvoice = new Map(rows.map((r) => [r.invoiceId, r]));
    expect(byInvoice.has(invoiceB)).toBe(false); // no overdue part -> not a defaulter

    const rowA = byInvoice.get(invoiceA);
    expect(rowA).toBeTruthy();
    expect(rowA?.onPlan).toBe(false);
    expect(rowA?.dueOn).toBe("2026-04-11"); // invoice's own due_on, no plan

    const rowC = byInvoice.get(invoiceC);
    expect(rowC).toBeTruthy();
    expect(rowC?.onPlan).toBe(true);
    expect(rowC?.dueOn).toBe("2026-05-01"); // earliest unpaid part's due_on, not the invoice's due_on
  });

  it("fee_plans stored false -> listDefaulters behaviour is unchanged (existing plans still shape defaulters)", async () => {
    const inst = await createTestInstitution("fpd-list-off");
    createdInstitutions.push(inst);
    const { termId, invoiceA, invoiceB, invoiceC } = await buildFixture(inst);
    await sql`update public.institutions set settings = settings || '{"modules": {"fee_plans": false}}'::jsonb where id = ${inst.institutionId}`;

    const ctx = await buildContext(inst, "accountant");
    setActingClient(inst.clientAs("accountant"));
    let rows;
    try {
      rows = await listDefaulters(ctx, { termId });
    } finally {
      setActingClient(null);
    }

    const byInvoice = new Map(rows.map((r) => [r.invoiceId, r]));
    expect(byInvoice.has(invoiceB)).toBe(false);
    expect(byInvoice.get(invoiceA)?.onPlan).toBe(false);
    expect(byInvoice.get(invoiceC)?.onPlan).toBe(true);
  });
});

describe("finance.fee_reminder handler respects instalment plans (X04-T9)", () => {
  it("sends reminders for the no-plan invoice and the plan invoice with an overdue part only", async () => {
    const inst = await createTestInstitution("fpd-reminder");
    createdInstitutions.push(inst);
    const { termId, invoiceA, invoiceC } = await buildFixture(inst);
    const asOf = "2026-11-05";

    await feeReminder(makeJob(inst.institutionId, termId, asOf, crypto.randomUUID()), { admin });

    const reminders = await sql`
      select invoice_id from public.fee_reminders
      where institution_id = ${inst.institutionId}::uuid and reminder_date = ${asOf}
    `;
    const invoiceIds = reminders.map((r) => r.invoice_id as string).sort();
    expect(invoiceIds).toEqual([invoiceA, invoiceC].sort());
  });

  it("fee_plans stored false -> handler behaviour is unchanged", async () => {
    const inst = await createTestInstitution("fpd-reminder-off");
    createdInstitutions.push(inst);
    const { termId, invoiceA, invoiceC } = await buildFixture(inst);
    await sql`update public.institutions set settings = settings || '{"modules": {"fee_plans": false}}'::jsonb where id = ${inst.institutionId}`;
    const asOf = "2026-11-05";

    await feeReminder(makeJob(inst.institutionId, termId, asOf, crypto.randomUUID()), { admin });

    const reminders = await sql`
      select invoice_id from public.fee_reminders
      where institution_id = ${inst.institutionId}::uuid and reminder_date = ${asOf}
    `;
    const invoiceIds = reminders.map((r) => r.invoice_id as string).sort();
    expect(invoiceIds).toEqual([invoiceA, invoiceC].sort());
  });
});
