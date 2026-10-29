import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (same shape as tests/db/invoice-generation.test.ts) — only
// this file's module graph gets them; every other db test file still uses
// the real `@/lib/supabase/server`.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { recordPayment } from "@/modules/finance/actions";
import { getReceipt, listDefaulters, listLedgerEntries } from "@/modules/finance/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createFeeAssignment,
  createFeeComponent,
  createFeeStructure,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Local fixture helpers (packet: ad-hoc fixtures stay in the test file, not
// tests/helpers/factories.ts — same convention as tests/db/finance.test.ts
// and tests/db/invoice-generation.test.ts's own copies of this).
async function setFinanceSettings(institutionId: string, paymentModes: string[] = ["cash", "upi", "cheque", "neft", "card"]): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object(
        'financial_year_start_month', 4, 'default_due_day', 10,
        'payment_modes', ${sql.json(paymentModes)}
      ),
      'numbering', jsonb_build_object(
        'admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}'
      )
    )
    where id = ${institutionId}
  `;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** Full setup: term + default fee structure (one tuition component) + a generated invoice for one student. Returns institutionId-scoped ids. */
async function setupInvoice(institutionId: string, admissionNo: string, amount = 10000) {
  await setFinanceSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const studentId = await createStudent(institutionId, admissionNo);
  await createFeeAssignment(institutionId, studentId, structureId, yearId);

  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  return { termId, studentId, invoiceId: row.id as string };
}

describe("recordPayment action (T-032, 06 §W9)", () => {
  it("accountant can record a payment; admin is forbidden (finance.payment.record excludes admin, 07 §2.2)", async () => {
    const inst = await createTestInstitution("payments-permission");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-PAY-PERM");

      const adminResult = await callAs(inst, "admin", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(adminResult).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const accountantResult = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 4000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(accountantResult.ok).toBe(true);
      if (accountantResult.ok) {
        expect(accountantResult.data.receiptNo).toMatch(/^RCT\//);
        expect(accountantResult.data.paymentId).toBeTruthy();
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("replaying the same idempotencyKey through the action returns the same receipt and does not create a second payment (AC2)", async () => {
    const inst = await createTestInstitution("payments-idempotency");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-PAY-IDEM");
      const idempotencyKey = crypto.randomUUID();
      const input = { invoiceId, amount: 3000, mode: "upi", receivedAt: new Date(), idempotencyKey };

      const first = await callAs(inst, "accountant", recordPayment, input);
      const second = await callAs(inst, "accountant", recordPayment, input);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.data.receiptNo).toBe(first.data.receiptNo);
        expect(second.data.paymentId).toBe(first.data.paymentId);
      }

      const [{ count }] = await sql`select count(*)::int as count from public.payments where invoice_id = ${invoiceId}`;
      expect(count).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("an invoice id from another institution is not_found — never forwarded to the SQL function (BOLA guard)", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const { invoiceId } = await setupInvoice(instA.institutionId, "ADM-PAY-BOLA");
      await setFinanceSettings(instB.institutionId);

      const result = await callAs(instB, "accountant", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  it("a mode not in the institution's own settings.finance.payment_modes is rejected (packet rule: validate from settings, not only the DB check constraint)", async () => {
    const inst = await createTestInstitution("payments-mode");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-PAY-MODE");
      // "card" passes the DB's check constraint but isn't in this school's own list.
      await setFinanceSettings(inst.institutionId, ["cash", "upi"]);

      const result = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "card",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("recording more than the outstanding balance is rejected with validation_failed (AC3)", async () => {
    const inst = await createTestInstitution("payments-overpay");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-PAY-OVERPAY", 10000);
      await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 3000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });

      // outstanding is 10000 - 3000 = 7000; 8000 exceeds it.
      const result = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 8000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("getReceipt (T-032)", () => {
  it("renders from the receipt's snapshot and is institution-scoped (AC1)", async () => {
    const inst = await createTestInstitution("receipts-scope");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-RCT-SCOPE");
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 2500,
        mode: "neft",
        reference: "UTR-999",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const receipt = await getReceipt(ctx, paid.data.receiptId);
        expect(receipt).not.toBeNull();
        expect(receipt?.receiptNo).toBe(paid.data.receiptNo);
        expect(receipt?.snapshot.amount).toBe(2500);
        expect(receipt?.snapshot.mode).toBe("neft");
        expect(receipt?.snapshot.reference).toBe("UTR-999");
        expect(receipt?.snapshot.invoiceId).toBe(invoiceId);
        expect(receipt?.snapshot.heads.length).toBeGreaterThan(0);

        // Cross-tenant: a receipt id that is real, but not scoped to this
        // caller's institution, must come back null (explicit not_found at
        // the page), not another institution's data.
        const other = await createTestInstitution("receipts-scope-other");
        try {
          const otherCtx = await buildContext(other, "accountant");
          setActingClient(other.clientAs("accountant"));
          const crossTenant = await getReceipt(otherCtx, paid.data.receiptId);
          expect(crossTenant).toBeNull();
        } finally {
          await other.cleanup();
        }
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  // T-032 phase 2 (20261028000021) — the snapshot's display fields are
  // captured at payment time; renaming the student afterwards must not
  // change an already-printed receipt (the whole point of a snapshot).
  it("snapshot display fields are present and unchanged after the student is renamed", async () => {
    const inst = await createTestInstitution("receipts-snapshot-rename");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });
      const studentId = await createStudent(inst.institutionId, "ADM-RCT-RENAME");
      await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);
      await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1 });

      const [{ id: invoiceId }] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;

      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId: invoiceId as string,
        amount: 4000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const before = await getReceipt(ctx, paid.data.receiptId);
        expect(before?.snapshot.studentName).toBe("Test");
        expect(before?.snapshot.admissionNo).toBe("ADM-RCT-RENAME");
        expect(before?.snapshot.classLabel).toMatch(/-A$/);
        expect(before?.snapshot.invoiceNo).toMatch(/^INV\//);
        expect(before?.snapshot.termName).toBe("Term 1");
        expect(before?.snapshot.receiptNo).toBe(paid.data.receiptNo);
        expect(before?.snapshot.schoolName).toBeTruthy();

        await sql`update public.students set first_name = 'Renamed', admission_no = 'ADM-RCT-CHANGED' where id = ${studentId}::uuid`;
        await sql`update public.institutions set name = 'Renamed School' where id = ${inst.institutionId}::uuid`;

        const after = await getReceipt(ctx, paid.data.receiptId);
        expect(after?.snapshot.studentName).toBe(before?.snapshot.studentName);
        expect(after?.snapshot.admissionNo).toBe(before?.snapshot.admissionNo);
        expect(after?.snapshot.schoolName).toBe(before?.snapshot.schoolName);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});

describe("listLedgerEntries (T-032, AC4)", () => {
  it("balances total debit and total credit over the selected range and caps the page size", async () => {
    const inst = await createTestInstitution("ledger-balance");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-LEDGER", 10000);
      await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 4000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 3000,
        mode: "upi",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        // entry_date is institution-local (record_payment uses settings timezone), not UTC.
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        const ledger = await listLedgerEntries(ctx, { from: today, to: today }, 1, 500);
        expect(ledger.balanced).toBe(true);
        expect(ledger.totalDebit).toBe(ledger.totalCredit);
        expect(ledger.totalDebit).toBeGreaterThan(0);
        expect(ledger.pageSize).toBeLessThanOrEqual(100);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects a reversed date range", async () => {
    const inst = await createTestInstitution("ledger-badrange");
    try {
      await setFinanceSettings(inst.institutionId);
      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        await expect(listLedgerEntries(ctx, { from: "2026-12-01", to: "2026-01-01" })).rejects.toThrow();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});

describe("listDefaulters (T-032, AC4)", () => {
  it("excludes a fully paid student but includes a part-paid one", async () => {
    const inst = await createTestInstitution("defaulters-filter");
    try {
      await setFinanceSettings(inst.institutionId);
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
      const gradeId = await createGrade(inst.institutionId);
      const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
      await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 10000, frequency: "term" });

      const paidStudent = await createStudent(inst.institutionId, "ADM-DEF-PAID");
      const partStudent = await createStudent(inst.institutionId, "ADM-DEF-PART");
      await createFeeAssignment(inst.institutionId, paidStudent, structureId, yearId);
      await createFeeAssignment(inst.institutionId, partStudent, structureId, yearId);

      const [paidInvoice] = await sql`select app.generate_invoice(${paidStudent}::uuid, ${termId}::uuid) as id`;
      const [partInvoice] = await sql`select app.generate_invoice(${partStudent}::uuid, ${termId}::uuid) as id`;

      await callAs(inst, "accountant", recordPayment, {
        invoiceId: paidInvoice.id as string,
        amount: 10000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      await callAs(inst, "accountant", recordPayment, {
        invoiceId: partInvoice.id as string,
        amount: 2000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const defaulters = await listDefaulters(ctx, { termId });
        expect(defaulters.map((d) => d.studentId)).toEqual([partStudent]);
        expect(defaulters[0].outstanding).toBe(8000);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
