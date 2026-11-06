// X04-T8 — job `fee_plans.late_fees` + runner sweep (06 ruling "Nightly
// application"). The handler itself is a thin RPC call to `apply_late_fees`
// (X04-T4, proven exhaustively in tests/db/fee-plans-late-fees-sql.test.ts);
// this file proves the sweep -> job -> handler wiring only: handler called
// directly against the real DB (same shape as tests/db/report-generate-
// job.test.ts), never via `runOnceCore` (that would also process the demo
// tenant's own job — forbidden by the packet).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { lateFees } from "@/modules/jobs/handlers/fee_plans.late_fees";
import type { JobRow } from "@/modules/jobs/types";
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

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
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

async function setupOverdueInvoice(
  institutionId: string,
  admissionNo: string,
): Promise<{ invoiceId: string }> {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId, { name: `2026-27-${admissionNo}` });
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId, { code: `G-${admissionNo}` });
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  await createFeeAssignment(institutionId, student.id as string, structureId, yearId);
  const [invoice] = await sql`select app.generate_invoice(${student.id}::uuid, ${termId}::uuid) as id`;
  const invoiceId = invoice.id as string;

  await sql`
    insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount, grace_days)
    values (${institutionId}, ${structureId}, 'flat', 200, 0)
  `;
  await sql`update public.invoices set due_on = current_date - 5 where id = ${invoiceId}`;
  return { invoiceId };
}

function makeJob(institutionId: string, overrides: Partial<JobRow> = {}): JobRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "fee_plans.late_fees",
    payload: { as_of: now.slice(0, 10) },
    idempotency_key: `fee_plans.late_fees:${institutionId}:${now.slice(0, 10)}`,
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: now,
    locked_by: "worker-1",
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("fee_plans.late_fees handler (direct, real DB)", () => {
  it("applies one charge for an overdue invoice; rerun adds none", async () => {
    const inst = await createTestInstitution("fp-job");
    createdInstitutions.push(inst);
    const { invoiceId } = await setupOverdueInvoice(inst.institutionId, "ADM-JOB");

    await lateFees(makeJob(inst.institutionId), { admin });
    const charges = await sql`select amount::numeric as amount from public.late_fee_charges where invoice_id = ${invoiceId}`;
    expect(charges).toHaveLength(1);
    expect(Number(charges[0].amount)).toBe(200);

    await lateFees(makeJob(inst.institutionId), { admin });
    const chargesAfterRerun = await sql`select id from public.late_fee_charges where invoice_id = ${invoiceId}`;
    expect(chargesAfterRerun).toHaveLength(1);
  }, 20_000);

  it("throws when the job has no institution_id", async () => {
    await expect(lateFees(makeJob("x", { institution_id: null }), { admin })).rejects.toThrow(
      /no institution_id/,
    );
  });
});

describe("enqueue_due_late_fees sweep -> fee_plans.late_fees job -> handler (end to end)", () => {
  async function jobsFor(institutionId: string): Promise<JobRow[]> {
    const rows = await sql`
      select id, institution_id, type, payload, idempotency_key, status, attempts, max_attempts,
             run_after, locked_at, locked_by, last_error, created_at, updated_at
      from public.jobs where institution_id = ${institutionId} and type = 'fee_plans.late_fees'
    `;
    return rows as unknown as JobRow[];
  }

  it("the enqueued job's handler run charges the overdue invoice exactly once; module off enqueues nothing", async () => {
    const inst = await createTestInstitution("fp-job-sweep");
    createdInstitutions.push(inst);
    const { invoiceId } = await setupOverdueInvoice(inst.institutionId, "ADM-JOB-SWEEP");

    await sql`select public.enqueue_due_late_fees()`;
    const jobs = await jobsFor(inst.institutionId);
    expect(jobs).toHaveLength(1);

    await lateFees(jobs[0], { admin });
    const charges = await sql`select id from public.late_fee_charges where invoice_id = ${invoiceId}`;
    expect(charges).toHaveLength(1);

    await sql`update public.institutions set settings = settings || '{"modules": {"finance_plus": false}}'::jsonb where id = ${inst.institutionId}`;
    await sql`delete from public.jobs where institution_id = ${inst.institutionId} and type = 'fee_plans.late_fees'`;
    await sql`select public.enqueue_due_late_fees()`;
    expect(await jobsFor(inst.institutionId)).toHaveLength(0);
  }, 20_000);
});
