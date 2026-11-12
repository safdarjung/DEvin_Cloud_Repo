// Curveball sweep (finance): action-level gaps not covered by payments/finance/finance-void/invoice-generation tests —
// generateStudentInvoice, bulkGenerateStudentInvoices, recordPayment amount edges, concurrency, exact sums.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { bulkGenerateStudentInvoices, generateStudentInvoice, recordPayment } from "@/modules/finance/actions";
import { voidPayment } from "@/modules/finance/reversals.actions";
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
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let termId: string;
let yearId: string;
let structureId: string;
let otherStudentId: string;

async function setFinanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'locale', jsonb_build_object('timezone', 'Asia/Kolkata', 'currency', 'INR'),
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10,
        'payment_modes', ${sql.json(["cash", "upi", "cheque", "neft", "card"])}),
      'numbering', jsonb_build_object('admission_no', 'ADM/{YYYY}/{SEQ:5}', 'invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}')
    )
    where id = ${institutionId}
  `;
}

async function student(institutionId: string, assign = true): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`CB-${crypto.randomUUID().slice(0, 8)}`}, 'Curve', '2015-01-01', 'other')
    returning id
  `;
  if (assign) await createFeeAssignment(institutionId, row.id as string, structureId, yearId);
  return row.id as string;
}

async function invoiceFor(studentId: string): Promise<string> {
  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  return row.id as string;
}

const pay = (invoiceId: string, amount: unknown) => ({
  invoiceId,
  amount,
  mode: "cash",
  receivedAt: new Date().toISOString(),
  idempotencyKey: crypto.randomUUID(),
});

beforeAll(async () => {
  inst = await createTestInstitution("fin-cb");
  other = await createTestInstitution("fin-cb-x");
  await setFinanceSettings(inst.institutionId);
  await setFinanceSettings(other.institutionId);
  yearId = await createAcademicYear(inst.institutionId);
  termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId);
  structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount: 1000, frequency: "term" });
  const [s] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${other.institutionId}, ${`X-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other') returning id
  `;
  otherStudentId = s.id as string;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("generateStudentInvoice curveballs", () => {
  it("accountant generates once; a second call returns the same invoice and never a duplicate row", async () => {
    const sid = await student(inst.institutionId);
    const a = await callAs(inst, "accountant", generateStudentInvoice, { studentId: sid, termId });
    const b = await callAs(inst, "accountant", generateStudentInvoice, { studentId: sid, termId });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.data.invoiceId).toBe(a.data.invoiceId);
    const [c] = await sql`select count(*)::int as n from public.invoices where student_id = ${sid} and term_id = ${termId}`;
    expect(c.n).toBe(1);
  });

  it("admin and teacher are forbidden; nothing is written", async () => {
    const sid = await student(inst.institutionId);
    for (const role of ["admin", "teacher", "guardian"] as const) {
      const r = await callAs(inst, role, generateStudentInvoice, { studentId: sid, termId });
      expect(r.ok ? "ok" : r.error.code).toBe("forbidden");
    }
    const [c] = await sql`select count(*)::int as n from public.invoices where student_id = ${sid}`;
    expect(c.n).toBe(0);
  });

  it("another institution's student → not_found", async () => {
    const r = await callAs(inst, "accountant", generateStudentInvoice, { studentId: otherStudentId, termId });
    expect(r.ok ? "ok" : r.error.code).toBe("not_found");
  });

  it("extra keys and non-uuids → validation_failed with fieldErrors", async () => {
    const r = await callAs(inst, "accountant", generateStudentInvoice, { studentId: "nope", termId, total: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation_failed");
    expect(r.error.fieldErrors?.studentId).toBeTruthy();
  });
});

describe("bulkGenerateStudentInvoices curveballs", () => {
  it("dedupes repeated ids and reports a student without a fee structure as failed, not thrown", async () => {
    const good = await student(inst.institutionId);
    const bare = await student(inst.institutionId, false);
    const r = await callAs(inst, "accountant", bulkGenerateStudentInvoices, { termId, studentIds: [good, good, bare] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.generated.map((g) => g.studentId)).toEqual([good]);
    expect(r.data.failed.map((f) => f.studentId)).toEqual([bare]);
    expect(r.data.failed[0]!.code).not.toBe("internal");
    const [c] = await sql`select count(*)::int as n from public.invoices where student_id = ${good}`;
    expect(c.n).toBe(1);
  });

  it("one foreign student id refuses the whole batch with not_found; no invoice is written for the local ones", async () => {
    const local = await student(inst.institutionId);
    const r = await callAs(inst, "accountant", bulkGenerateStudentInvoices, { termId, studentIds: [local, otherStudentId] });
    expect(r.ok ? "ok" : r.error.code).toBe("not_found");
    const [c] = await sql`select count(*)::int as n from public.invoices where student_id = ${local}`;
    expect(c.n).toBe(0);
  });

  it("empty list and >200 ids → validation_failed on studentIds; admin forbidden", async () => {
    const empty = await callAs(inst, "accountant", bulkGenerateStudentInvoices, { termId, studentIds: [] });
    expect(empty.ok ? null : empty.error.fieldErrors?.studentIds).toBeTruthy();
    const many = Array.from({ length: 201 }, () => crypto.randomUUID());
    const big = await callAs(inst, "accountant", bulkGenerateStudentInvoices, { termId, studentIds: many });
    expect(big.ok ? null : big.error.fieldErrors?.studentIds).toBeTruthy();
    const sid = await student(inst.institutionId);
    const adm = await callAs(inst, "admin", bulkGenerateStudentInvoices, { termId, studentIds: [sid] });
    expect(adm.ok ? "ok" : adm.error.code).toBe("forbidden");
  });

  it("a term from another institution → not_found", async () => {
    const oy = await createAcademicYear(other.institutionId);
    const ot = await createTerm(other.institutionId, oy, { sequence: 1 });
    const sid = await student(inst.institutionId);
    const r = await callAs(inst, "accountant", bulkGenerateStudentInvoices, { termId: ot, studentIds: [sid] });
    expect(r.ok ? "ok" : r.error.code).toBe("not_found");
  });
});

describe("recordPayment curveballs", () => {
  it.each([
    ["zero", 0],
    ["negative", -10],
    ["fractional paise", 10.005],
    ["string amount", "100"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("%s amount → validation_failed on amount, nothing written", async (_label, amount) => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const r = await callAs(inst, "accountant", recordPayment, pay(inv, amount));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation_failed");
    expect(r.error.fieldErrors?.amount).toBeTruthy();
    const [c] = await sql`select count(*)::int as n from public.payments where invoice_id = ${inv}`;
    expect(c.n).toBe(0);
  });

  it("0.1 + 0.2 + 999.70 settles a 1000.00 invoice exactly: paid, paid_total 1000.00, no float drift", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    for (const amt of [0.1, 0.2, 999.7]) {
      const r = await callAs(inst, "accountant", recordPayment, pay(inv, amt));
      expect(r.ok).toBe(true);
    }
    const [row] = await sql`select paid_total::text as p, status from public.invoices where id = ${inv}`;
    expect(row.p).toBe("1000.00");
    expect(row.status).toBe("paid");
    const [s] = await sql`select sum(amount)::text as s from public.payments where invoice_id = ${inv}`;
    expect(s.s).toBe("1000.00");
  });

  it("paying a fully paid invoice again is refused and writes nothing", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const first = await callAs(inst, "accountant", recordPayment, pay(inv, 1000));
    expect(first.ok).toBe(true);
    const again = await callAs(inst, "accountant", recordPayment, pay(inv, 1));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(["validation_failed", "invalid_state"]).toContain(again.error.code);
    const [c] = await sql`select count(*)::int as n from public.payments where invoice_id = ${inv}`;
    expect(c.n).toBe(1);
  });

  it("two parallel 600.00 payments on a 1000.00 invoice: exactly one succeeds, never overpaid", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const rs = await Promise.all([
      callAs(inst, "accountant", recordPayment, pay(inv, 600)),
      callAs(inst, "accountant", recordPayment, pay(inv, 600)),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await sql`select paid_total::text as p from public.invoices where id = ${inv}`;
    expect(row.p).toBe("600.00");
  });

  it("eight parallel payments get eight distinct, consecutive receipt numbers", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const rs = await Promise.all(Array.from({ length: 8 }, () => callAs(inst, "accountant", recordPayment, pay(inv, 10))));
    const nos = rs.map((r) => (r.ok ? r.data.receiptNo : `ERR:${r.error.code}`));
    expect(nos.filter((n) => n.startsWith("ERR"))).toEqual([]);
    expect(new Set(nos).size).toBe(8);
    const seqs = nos.map((n) => Number(n.split("/").pop())).sort((a, b) => a - b);
    expect(seqs[7]! - seqs[0]!).toBe(7);
  });

  it("the same idempotency key fired in parallel yields one payment", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const body = pay(inv, 50);
    const rs = await Promise.all([1, 2, 3].map(() => callAs(inst, "accountant", recordPayment, body)));
    const okIds = new Set(rs.filter((r) => r.ok).map((r) => (r.ok ? r.data.paymentId : "")));
    expect(okIds.size).toBe(1);
    const [c] = await sql`select count(*)::int as n from public.payments where invoice_id = ${inv}`;
    expect(c.n).toBe(1);
  });

  // Regression (fixed in 0145): app.record_payment (0021) never checks status = 'cancelled' (0074/0086 do); it then flips the invoice back to part_paid.
  it("a cancelled invoice cannot take a payment", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    await sql`update public.invoices set status = 'cancelled' where id = ${inv}`;
    const r = await callAs(inst, "accountant", recordPayment, pay(inv, 10));
    expect(r.ok).toBe(false);
    const [c] = await sql`select count(*)::int as n from public.payments where invoice_id = ${inv}`;
    expect(c.n).toBe(0);
  });
});

describe("voidPayment curveballs", () => {
  it("refunding the same payment twice under two keys: second is refused; the reversal is a new row and the original is untouched", async () => {
    const inv = await invoiceFor(await student(inst.institutionId));
    const p = await callAs(inst, "accountant", recordPayment, pay(inv, 400));
    if (!p.ok) throw new Error("payment fixture failed");
    const [before] = await sql`select amount::text as a, created_at from public.payments where id = ${p.data.paymentId}`;
    const v1 = await callAs(inst, "principal", voidPayment, { paymentId: p.data.paymentId, kind: "refund", reason: "Parent withdrew", idempotencyKey: crypto.randomUUID() });
    expect(v1.ok).toBe(true);
    const v2 = await callAs(inst, "owner", voidPayment, { paymentId: p.data.paymentId, kind: "refund", reason: "Parent withdrew", idempotencyKey: crypto.randomUUID() });
    expect(v2.ok).toBe(false);
    const [after] = await sql`select amount::text as a from public.payments where id = ${p.data.paymentId}`;
    expect(after.a).toBe(before.a);
    const [inv2] = await sql`select paid_total::text as p from public.invoices where id = ${inv}`;
    expect(inv2.p).toBe("0.00");
  });

  it("short reason and unknown kind → validation_failed with fieldErrors", async () => {
    const r = await callAs(inst, "principal", voidPayment, { paymentId: crypto.randomUUID(), kind: "chargeback", reason: "x", idempotencyKey: crypto.randomUUID() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("validation_failed");
    expect(Object.keys(r.error.fieldErrors ?? {})).toEqual(expect.arrayContaining(["kind", "reason"]));
  });
});
