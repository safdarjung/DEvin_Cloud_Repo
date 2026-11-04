import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (same shape as tests/db/payments.test.ts) — only this file's
// module graph gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { recordPayment } from "@/modules/finance/actions";
import { voidPayment } from "@/modules/finance/reversals.actions";
import { getReceipt } from "@/modules/finance/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
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
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Local fixture helpers — ad-hoc copies of tests/db/payments.test.ts's own
// (packet convention: fixtures stay in the test file, not factories.ts).
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

describe("voidPayment action (M12-T7)", () => {
  it("principal voids a cash payment — invoice outstanding restored, status back to issued", async () => {
    const inst = await createTestInstitution("void-principal");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-OK", 10000);
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 4000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const result = await callAs(inst, "principal", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "Wrong amount entered at the counter.",
        idempotencyKey: crypto.randomUUID(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.invoiceId).toBe(invoiceId);
        expect(result.data.invoiceStatus).toBe("issued");
        expect(result.data.paidTotal).toBe(0);
        expect(result.data.reversalId).toBeTruthy();
      }

      const [invoice] = await sql`select status, paid_total from public.invoices where id = ${invoiceId}`;
      expect(invoice.status).toBe("issued");
      expect(Number(invoice.paid_total)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant is forbidden (finance.payment.void = owner, principal only, 07 §2.2)", async () => {
    const inst = await createTestInstitution("void-permission");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-PERM");
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const result = await callAs(inst, "accountant", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "Accountant should not be able to void this.",
        idempotencyKey: crypto.randomUUID(),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a payment id from another institution is not_found — RPC never called (BOLA guard)", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const { invoiceId } = await setupInvoice(instA.institutionId, "ADM-VOID-BOLA");
      await setFinanceSettings(instB.institutionId);
      const paid = await callAs(instA, "accountant", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const result = await callAs(instB, "principal", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "Cross-tenant probe reason.",
        idempotencyKey: crypto.randomUUID(),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  it("replaying the same idempotencyKey returns the same reversalId and does not reverse twice", async () => {
    const inst = await createTestInstitution("void-idempotency");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-IDEM");
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 2000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const idempotencyKey = crypto.randomUUID();
      const input = { paymentId: paid.data.paymentId, kind: "void" as const, reason: "Replay probe reason text.", idempotencyKey };

      const first = await callAs(inst, "owner", voidPayment, input);
      const second = await callAs(inst, "owner", voidPayment, input);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.data.reversalId).toBe(first.data.reversalId);
      }

      const [{ count }] = await sql`select count(*)::int as count from public.payment_reversals where payment_id = ${paid.data.paymentId}`;
      expect(count).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a payment already reversed under a different key is conflict", async () => {
    const inst = await createTestInstitution("void-conflict");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-CONFLICT");
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 1000,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const firstVoid = await callAs(inst, "owner", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "First reversal reason text.",
        idempotencyKey: crypto.randomUUID(),
      });
      expect(firstVoid.ok).toBe(true);

      const secondVoid = await callAs(inst, "owner", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "Second reversal reason text.",
        idempotencyKey: crypto.randomUUID(),
      });
      expect(secondVoid).toMatchObject({ ok: false, error: { code: "conflict" } });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("void_payment review fixes (M12 security review)", () => {
  it("an idempotency key already used for another payment is conflict; that payment stays unreversed", async () => {
    const inst = await createTestInstitution("void-key-reuse");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-KEY");
      const pay = async (amount: number) => {
        const r = await callAs(inst, "accountant", recordPayment, {
          invoiceId, amount, mode: "cash", receivedAt: new Date(), idempotencyKey: crypto.randomUUID(),
        });
        if (!r.ok) throw new Error("setup payment failed");
        return r.data.paymentId;
      };
      const paymentA = await pay(2000);
      const paymentB = await pay(1000);
      const idempotencyKey = crypto.randomUUID();

      const first = await callAs(inst, "owner", voidPayment, { paymentId: paymentA, kind: "void", reason: "First void reason.", idempotencyKey });
      expect(first.ok).toBe(true);
      const second = await callAs(inst, "owner", voidPayment, { paymentId: paymentB, kind: "void", reason: "Second void reason.", idempotencyKey });
      expect(second).toMatchObject({ ok: false, error: { code: "conflict" } });

      const reversed = await sql`select id from public.payment_reversals where payment_id = ${paymentB}`;
      expect(reversed).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it.each([
    { kind: "refund" as const, mode: "upi" },
    { kind: "cheque_bounce" as const, mode: "cheque" },
  ])("$kind on a $mode payment posts Dr fees_receivable / Cr bank", async ({ kind, mode }) => {
    const inst = await createTestInstitution(`void-${kind.replace("_", "-")}`);
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, `ADM-VOID-${kind}`);
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId, amount: 3000, mode, reference: "REF-1", receivedAt: new Date(), idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const result = await callAs(inst, "principal", voidPayment, {
        paymentId: paid.data.paymentId, kind, reason: "Money went back to the payer.", idempotencyKey: crypto.randomUUID(),
      });
      expect(result.ok).toBe(true);

      const lines = await sql`
        select account, debit, credit, memo from public.ledger_entries
        where payment_id = ${paid.data.paymentId} and memo like ${kind + " receipt %"}
        order by debit desc
      `;
      expect(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)])).toEqual([
        ["fees_receivable", 3000, 0],
        ["bank", 0, 3000],
      ]);
      const [kindRow] = await sql`select kind from public.payment_reversals where payment_id = ${paid.data.paymentId}`;
      expect(kindRow.kind).toBe(kind);
    } finally {
      await inst.cleanup();
    }
  });

  it("a payment with no receipt row is invalid_state, not a 23502 crash", async () => {
    const inst = await createTestInstitution("void-no-receipt");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-NORCT");
      const [payment] = await sql`
        insert into public.payments (institution_id, invoice_id, amount, mode, received_at, idempotency_key)
        values (${inst.institutionId}, ${invoiceId}, 500, 'cash', now(), ${crypto.randomUUID()})
        returning id
      `;
      await expect(
        sql`select app.void_payment(${payment.id}::uuid, 'void', 'No receipt probe reason.', ${crypto.randomUUID()})`,
      ).rejects.toThrow(/code:invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("getReceipt reversal field (M12-T7)", () => {
  it("shows reversal after a void and null before", async () => {
    const inst = await createTestInstitution("void-receipt");
    try {
      const { invoiceId } = await setupInvoice(inst.institutionId, "ADM-VOID-RECEIPT");
      const paid = await callAs(inst, "accountant", recordPayment, {
        invoiceId,
        amount: 1500,
        mode: "cash",
        receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!paid.ok) throw new Error("setup payment failed");

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const before = await getReceipt(ctx, paid.data.receiptId);
        expect(before?.reversal).toBeNull();
      } finally {
        setActingClient(null);
      }

      const voided = await callAs(inst, "owner", voidPayment, {
        paymentId: paid.data.paymentId,
        kind: "void",
        reason: "Printed receipt was a duplicate.",
        idempotencyKey: crypto.randomUUID(),
      });
      expect(voided.ok).toBe(true);

      setActingClient(inst.clientAs("accountant"));
      try {
        const after = await getReceipt(ctx, paid.data.receiptId);
        expect(after?.reversal).not.toBeNull();
        expect(after?.reversal?.kind).toBe("void");
        expect(after?.reversal?.reason).toBe("Printed receipt was a duplicate.");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
