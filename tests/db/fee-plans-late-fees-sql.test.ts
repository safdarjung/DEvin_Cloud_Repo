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

// Migration 20261028000087 (X04-T4) — public.apply_late_fees,
// public.enqueue_due_late_fees, public.ledger_voucher_lines. Same
// direct-RPC / admin-bypass shape as tests/db/fee-plans-rls.test.ts and
// tests/db/finance-void.test.ts (fixtures stay local to the test file).

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

async function setupInvoice(
  institutionId: string,
  admissionNo: string,
  amount = 10000,
  isCurrent = true,
): Promise<{ invoiceId: string; studentId: string; structureId: string; yearId: string; feeAssignmentId: string }> {
  await setFinanceSettings(institutionId);
  // academic_years_one_current_idx (0002) allows only one is_current row per
  // institution: a test institution reused across several setupInvoice calls
  // passes isCurrent=false on the 2nd+ call. generate_invoice is called with
  // an explicit termId below, so is_current never affects this flow.
  const yearId = await createAcademicYear(institutionId, { name: `2026-27-${admissionNo}`, isCurrent });
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId, { code: `G-${admissionNo}` });
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  const studentId = student.id as string;
  const feeAssignmentId = await createFeeAssignment(institutionId, studentId, structureId, yearId);
  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  return { invoiceId: row.id as string, studentId, structureId, yearId, feeAssignmentId };
}

async function setDueOn(invoiceId: string, daysAgo: number): Promise<void> {
  await sql`update public.invoices set due_on = (now() at time zone 'Asia/Kolkata')::date - ${daysAgo}::int where id = ${invoiceId}`;
}

async function createRule(
  institutionId: string,
  structureId: string,
  overrides: { kind?: string; amount?: number; graceDays?: number; cap?: number | null; isActive?: boolean } = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount, grace_days, cap, is_active)
    values (
      ${institutionId}, ${structureId}, ${overrides.kind ?? "flat"}, ${overrides.amount ?? 200},
      ${overrides.graceDays ?? 0}, ${overrides.cap ?? null}, ${overrides.isActive ?? true}
    )
    returning id
  `;
  return row.id as string;
}

async function applyLateFees(institutionId: string): Promise<{ charges: number; amount: number }> {
  const [row] = await sql`select public.apply_late_fees(${institutionId}::uuid) as result`;
  return row.result as { charges: number; amount: number };
}

async function payInvoice(invoiceId: string, amount: number): Promise<void> {
  const { error } = (await sql`
    select app.record_payment(${invoiceId}::uuid, ${amount}, 'cash', null, now(), ${crypto.randomUUID()}) as result
  `.catch((e) => ({ error: e }))) as never;
  if (error) throw error;
}

describe("fee_plans migration (0087 part 2) — apply_late_fees", () => {
  it("flat rule charges once past grace; rerun adds nothing; books balanced", async () => {
    const inst = await createTestInstitution("fp-flat");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-FLAT");
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 200, graceDays: 3 });
      await setDueOn(invoiceId, 5); // 5 days late, grace 3 -> days_late 2

      const first = await applyLateFees(inst.institutionId);
      expect(first).toEqual({ charges: 1, amount: 200 });

      const [invoice] = await sql`select total::numeric as total, status from public.invoices where id = ${invoiceId}`;
      expect(Number(invoice.total)).toBe(10200);
      expect(invoice.status).toBe("issued"); // app.add_invoice_charge (X03) keeps status unless it was 'paid'

      const charges = await sql`select unit_seq, amount::numeric as amount, days_late from public.late_fee_charges where invoice_id = ${invoiceId}`;
      expect(charges).toHaveLength(1);
      expect(Number(charges[0].amount)).toBe(200);

      const ledger = await sql`select account, debit::numeric as debit, credit::numeric as credit from public.ledger_entries where invoice_id = ${invoiceId} and memo like 'late_fee%'`;
      expect(ledger).toHaveLength(2);
      const byAccount = Object.fromEntries(ledger.map((r) => [r.account, { debit: Number(r.debit), credit: Number(r.credit) }]));
      expect(byAccount.fees_receivable).toEqual({ debit: 200, credit: 0 });
      expect(byAccount.fee_income).toEqual({ debit: 0, credit: 200 });

      const rerun = await applyLateFees(inst.institutionId);
      expect(rerun).toEqual({ charges: 0, amount: 0 });
      const chargesAfterRerun = await sql`select id from public.late_fee_charges where invoice_id = ${invoiceId}`;
      expect(chargesAfterRerun).toHaveLength(1); // no duplicate
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("per_day rule: 4 days late -> 20, 30 days late -> capped at 50, 2 days late -> nothing", async () => {
    const inst = await createTestInstitution("fp-perday");
    try {
      const a = await setupInvoice(inst.institutionId, "ADM-PD-A", 10000, true);
      const b = await setupInvoice(inst.institutionId, "ADM-PD-B", 10000, false);
      const c = await setupInvoice(inst.institutionId, "ADM-PD-C", 10000, false);
      for (const s of [a, b, c]) {
        await createRule(inst.institutionId, s.structureId, { kind: "per_day", amount: 10, graceDays: 2, cap: 50 });
      }
      await setDueOn(a.invoiceId, 4);
      await setDueOn(b.invoiceId, 30);
      await setDueOn(c.invoiceId, 2);

      const result = await applyLateFees(inst.institutionId);
      expect(result).toEqual({ charges: 2, amount: 70 }); // 20 + 50; c produces nothing

      const amountFor = async (invoiceId: string) => {
        const [row] = await sql`select coalesce(sum(amount), 0)::numeric as total from public.late_fee_charges where invoice_id = ${invoiceId}`;
        return Number(row.total);
      };
      expect(await amountFor(a.invoiceId)).toBe(20);
      expect(await amountFor(b.invoiceId)).toBe(50);
      expect(await amountFor(c.invoiceId)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("principal paid but late fee unpaid -> no further charge on rerun", async () => {
    const inst = await createTestInstitution("fp-principal-paid");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-PPAID", 10000);
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 200 });
      await setDueOn(invoiceId, 5);

      const first = await applyLateFees(inst.institutionId);
      expect(first).toEqual({ charges: 1, amount: 200 });

      await payInvoice(invoiceId, 10000); // principal only, the 200 late fee stays unpaid

      const rerun = await applyLateFees(inst.institutionId);
      expect(rerun).toEqual({ charges: 0, amount: 0 });

      const [invoice] = await sql`select status, paid_total::numeric as paid_total, total::numeric as total from public.invoices where id = ${invoiceId}`;
      expect(invoice.status).toBe("part_paid"); // paid_total (10000) < total (10200)
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("instalment plan: charge lands on the overdue unit only; stops once that unit is paid", async () => {
    const inst = await createTestInstitution("fp-instalment");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-INST", 10000);
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 150 });
      await sql`
        insert into public.invoice_instalments (institution_id, invoice_id, seq, due_on, amount)
        values
          (${inst.institutionId}, ${invoiceId}, 1, (now() at time zone 'Asia/Kolkata')::date - 10, 4000),
          (${inst.institutionId}, ${invoiceId}, 2, (now() at time zone 'Asia/Kolkata')::date + 30, 6000)
      `;

      const first = await applyLateFees(inst.institutionId);
      expect(first).toEqual({ charges: 1, amount: 150 });
      const [charge] = await sql`select unit_seq from public.late_fee_charges where invoice_id = ${invoiceId}`;
      expect(charge.unit_seq).toBe(1);

      await payInvoice(invoiceId, 4000); // settles part 1 exactly

      const rerun = await applyLateFees(inst.institutionId);
      expect(rerun).toEqual({ charges: 0, amount: 0 });
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("ews_rte, paid, cancelled and inactive-rule invoices never get a late fee", async () => {
    const inst = await createTestInstitution("fp-skip");
    try {
      const ews = await setupInvoice(inst.institutionId, "ADM-EWS", 10000, true);
      await createRule(inst.institutionId, ews.structureId, { kind: "flat", amount: 200 });
      await setDueOn(ews.invoiceId, 5);
      await sql`
        insert into public.concessions (institution_id, fee_assignment_id, kind, percent, approved_by, reason)
        values (${inst.institutionId}, ${ews.feeAssignmentId}, 'ews_rte', 100, ${inst.users.principal.id}, 'RTE Act section 12')
      `;

      const paid = await setupInvoice(inst.institutionId, "ADM-PAID", 10000, false);
      await createRule(inst.institutionId, paid.structureId, { kind: "flat", amount: 200 });
      await setDueOn(paid.invoiceId, 5);
      await payInvoice(paid.invoiceId, 10000);

      const cancelled = await setupInvoice(inst.institutionId, "ADM-CANCEL", 10000, false);
      await createRule(inst.institutionId, cancelled.structureId, { kind: "flat", amount: 200 });
      await setDueOn(cancelled.invoiceId, 5);
      await sql`update public.invoices set status = 'cancelled' where id = ${cancelled.invoiceId}`;

      const inactive = await setupInvoice(inst.institutionId, "ADM-INACTIVE", 10000, false);
      await createRule(inst.institutionId, inactive.structureId, { kind: "flat", amount: 200, isActive: false });
      await setDueOn(inactive.invoiceId, 5);

      const result = await applyLateFees(inst.institutionId);
      expect(result).toEqual({ charges: 0, amount: 0 });

      for (const s of [ews, paid, cancelled, inactive]) {
        const rows = await sql`select id from public.late_fee_charges where invoice_id = ${s.invoiceId}`;
        expect(rows).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("fee_plans stored false -> zeros, data untouched", async () => {
    const inst = await createTestInstitution("fp-off");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-OFF");
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 200 });
      await setDueOn(invoiceId, 5);
      await sql`update public.institutions set settings = settings || '{"modules": {"finance_plus": false}}'::jsonb where id = ${inst.institutionId}`;

      const result = await applyLateFees(inst.institutionId);
      expect(result).toEqual({ charges: 0, amount: 0 });
    } finally {
      await inst.cleanup();
    }
  });

  it("authenticated cannot execute apply_late_fees or enqueue_due_late_fees", async () => {
    const inst = await createTestInstitution("fp-grants");
    try {
      const apply = await inst.clientAs("owner").rpc("apply_late_fees", { p_institution_id: inst.institutionId });
      expect(apply.error).not.toBeNull();

      const sweep = await inst.clientAs("owner").rpc("enqueue_due_late_fees", {});
      expect(sweep.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("fee_plans migration (0087 part 2) — enqueue_due_late_fees sweep", () => {
  async function jobCount(institutionId: string): Promise<number> {
    const [row] = await sql`select count(*)::int as n from public.jobs where institution_id = ${institutionId} and type = 'fee_plans.late_fees'`;
    return row.n as number;
  }

  it("enqueues one job per institution per day; a second sweep the same day stays at one; module off enqueues none", async () => {
    const inst = await createTestInstitution("fp-sweep");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-SWEEP");
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 200 });
      await setDueOn(invoiceId, 5);

      await sql`select public.enqueue_due_late_fees()`;
      // The sweep is global: drop the jobs it queued for other tenants (the seeded demo) so no later runner applies them.
      await sql`delete from public.jobs where type = 'fee_plans.late_fees' and status = 'queued' and institution_id <> ${inst.institutionId}`;
      expect(await jobCount(inst.institutionId)).toBe(1);

      await sql`select public.enqueue_due_late_fees()`;
      // The sweep is global: drop the jobs it queued for other tenants (the seeded demo) so no later runner applies them.
      await sql`delete from public.jobs where type = 'fee_plans.late_fees' and status = 'queued' and institution_id <> ${inst.institutionId}`;
      expect(await jobCount(inst.institutionId)).toBe(1); // idempotency key collapses the rerun

      await sql`update public.institutions set settings = settings || '{"modules": {"finance_plus": false}}'::jsonb where id = ${inst.institutionId}`;
      await sql`delete from public.jobs where institution_id = ${inst.institutionId} and type = 'fee_plans.late_fees'`;
      await sql`select public.enqueue_due_late_fees()`;
      // The sweep is global: drop the jobs it queued for other tenants (the seeded demo) so no later runner applies them.
      await sql`delete from public.jobs where type = 'fee_plans.late_fees' and status = 'queued' and institution_id <> ${inst.institutionId}`;
      expect(await jobCount(inst.institutionId)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("fee_plans migration (0087 part 2) — ledger_voucher_lines", () => {
  async function dateRange(): Promise<{ from: string; to: string }> {
    const [{ today }] = await sql<{ today: Date }[]>`select (now() at time zone 'Asia/Kolkata')::date as today`;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { from: iso(new Date(today.getTime() - 30 * 86_400_000)), to: iso(new Date(today.getTime() + 1 * 86_400_000)) };
  }

  it("a cash receipt yields 2 Receipt lines voucher_no = receipt_no; a late fee yields a Journal with charge_head", async () => {
    const inst = await createTestInstitution("fp-ledger");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst.institutionId, "ADM-LEDGER", 10000);
      await createRule(inst.institutionId, structureId, { kind: "flat", amount: 200 });
      await setDueOn(invoiceId, 5);
      await applyLateFees(inst.institutionId); // total now 10200

      await payInvoice(invoiceId, 10200);

      const [invoiceRow] = await sql`select invoice_no from public.invoices where id = ${invoiceId}`;
      const [receiptRow] = await sql`
        select r.receipt_no from public.receipts r join public.payments p on p.id = r.payment_id where p.invoice_id = ${invoiceId}
      `;

      const { from, to } = await dateRange();

      const receiptsOnly = await sql<
        { entry_id: string; voucher_type: string; voucher_no: string; account: string; debit: string; credit: string; charge_head: string | null }[]
      >`select * from public.ledger_voucher_lines(${inst.institutionId}::uuid, ${from}::date, ${to}::date, true)`;
      expect(receiptsOnly).toHaveLength(2);
      for (const row of receiptsOnly) {
        expect(row.voucher_type).toBe("Receipt");
        expect(row.voucher_no).toBe(receiptRow.receipt_no);
        expect(row.charge_head).toBeNull();
      }
      const receiptAccounts = receiptsOnly.map((r) => r.account).sort();
      expect(receiptAccounts).toEqual(["cash", "fees_receivable"]);

      const all = await sql<
        { entry_id: string; voucher_type: string; voucher_no: string; account: string; charge_head: string | null }[]
      >`select * from public.ledger_voucher_lines(${inst.institutionId}::uuid, ${from}::date, ${to}::date, false)`;
      const invoiceJournal = all.filter((r) => r.voucher_type === "Journal" && r.voucher_no === invoiceRow.invoice_no);
      expect(invoiceJournal.length).toBeGreaterThanOrEqual(2); // fees_receivable + fee_income

      const [{ today }] = await sql<{ today: Date }[]>`select (now() at time zone 'Asia/Kolkata')::date as today`;
      const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
      const lateFeeJournal = all.filter((r) => r.voucher_type === "Journal" && r.charge_head === "late_fee");
      expect(lateFeeJournal).toHaveLength(2);
      for (const row of lateFeeJournal) {
        expect(row.voucher_no).toBe(`${invoiceRow.invoice_no}/late_fee/${yyyymmdd}`);
      }

      const teacherView = await inst.clientAs("teacher").rpc("ledger_voucher_lines", {
        p_institution_id: inst.institutionId,
        p_from: from,
        p_to: to,
        p_receipts_only: false,
      });
      expect(teacherView.error).toBeNull();
      expect(teacherView.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
