// X04-T7 — src/modules/fee-plans/queries.ts's `ledgerExport` (TS layer on
// top of T4's `public.ledger_voucher_lines`, already covered at the SQL
// level by tests/db/fee-plans-late-fees-sql.test.ts). Same
// importOriginal + module-scope `actingClient` mock as
// tests/db/report-queries.test.ts: direct calls point `createClient()` at
// a fixture's real signed-in client, the HTTP tests (CSV header, teacher
// forbidden) fall through to the real bearer-token path untouched.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

let actingClient: SupabaseClient<Database> | null = null;

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => actingClient ?? actual.createClient(),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { GET } from "@/app/api/v1/query/[name]/route";
import { buildContext } from "../helpers/actions";
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
import { ledgerExport, type TallyRow } from "@/modules/fee-plans/queries";

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

/** One fee structure + a generated invoice for `amount` rupees (same shape as the other X04 db test files' local fixture). */
async function setupInvoice(
  inst: TestInstitution,
  admissionNo: string,
  amount = 1500,
): Promise<{ invoiceId: string; structureId: string }> {
  await setFinanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId, { name: `2026-27-${admissionNo}` });
  const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(inst.institutionId, { code: `G-${admissionNo}` });
  const structureId = await createFeeStructure(inst.institutionId, yearId, gradeId);
  await createFeeComponent(inst.institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  const studentId = student.id as string;
  await createFeeAssignment(inst.institutionId, studentId, structureId, yearId);

  const { data, error } = await inst.clientAs("accountant").rpc("generate_invoice", {
    p_student_id: studentId,
    p_term_id: termId,
  });
  if (error) throw error;
  return { invoiceId: data as string, structureId };
}

async function recordPayment(inst: TestInstitution, invoiceId: string, amount: number): Promise<string> {
  const { data, error } = await inst.clientAs("accountant").rpc("record_payment", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_mode: "cash",
    p_reference: null,
    p_received_at: new Date().toISOString(),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
  return (data as { payment_id: string }).payment_id;
}

async function voidPayment(inst: TestInstitution, paymentId: string): Promise<void> {
  const { error } = await inst.clientAs("principal").rpc("void_payment", {
    p_payment_id: paymentId,
    p_kind: "void",
    p_reason: "Test reversal for ledger export.",
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}

/** ±a day around today so a payment/charge recorded "now" always lands inside. */
function dateRange(): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(today.getTime() - 30 * 86_400_000)), to: iso(new Date(today.getTime() + 1 * 86_400_000)) };
}

describe("feePlans.ledgerExport — tally layout (X04-T7)", () => {
  it("a cash receipt yields 2 Receipt lines (DD-MM-YYYY date, 2-decimal amount string); receivableLedger renames the Cr line; Dr = Cr per voucher", async () => {
    const inst = await createTestInstitution("fp-export-tally");
    try {
      const { invoiceId } = await setupInvoice(inst, "ADM-EXP-A", 1500);
      await recordPayment(inst, invoiceId, 1500);
      const { from, to } = dateRange();

      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        const rows = await ledgerExport(ctx, { from, to, layout: "tally", include: "receipts" });
        expect(rows).toHaveLength(2);
        for (const row of rows as TallyRow[]) {
          expect(row).toMatchObject({ "Voucher Type": "Receipt", Amount: "1500.00" });
          expect(row.Date).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        }
        const byName = Object.fromEntries((rows as { "Ledger Name": string; "Dr/Cr": string }[]).map((r) => [r["Ledger Name"], r["Dr/Cr"]]));
        expect(byName).toEqual({ Cash: "Dr", "Fees Receivable": "Cr" });

        const renamed = await ledgerExport(ctx, { from, to, layout: "tally", include: "receipts", receivableLedger: "Fee Income" });
        const renamedNames = (renamed as { "Ledger Name": string }[]).map((r) => r["Ledger Name"]).sort();
        expect(renamedNames).toEqual(["Cash", "Fee Income"]);

        const drTotal = (rows as { "Dr/Cr": string; Amount: string }[])
          .filter((r) => r["Dr/Cr"] === "Dr")
          .reduce((sum, r) => sum + Number(r.Amount), 0);
        const crTotal = (rows as { "Dr/Cr": string; Amount: string }[])
          .filter((r) => r["Dr/Cr"] === "Cr")
          .reduce((sum, r) => sum + Number(r.Amount), 0);
        expect(drTotal).toBe(crTotal);
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("include=all adds the invoice Journal and a late-fee Journal whose Cr line is Late Fee Income", async () => {
    const inst = await createTestInstitution("fp-export-all");
    try {
      const { invoiceId, structureId } = await setupInvoice(inst, "ADM-EXP-B", 1500);
      await sql`
        insert into public.late_fee_rules (institution_id, fee_structure_id, kind, amount, grace_days)
        values (${inst.institutionId}, ${structureId}, 'flat', 200, 0)
      `;
      await sql`update public.invoices set due_on = current_date - 5 where id = ${invoiceId}`;
      await sql`select public.apply_late_fees(${inst.institutionId}::uuid) as result`;
      const { from, to } = dateRange();

      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        const [invoiceRow] = await sql`select invoice_no from public.invoices where id = ${invoiceId}`;

        const rows = await ledgerExport(ctx, { from, to, layout: "tally", include: "all" });
        const journals = (rows as { "Voucher Type": string; "Voucher No": string; "Ledger Name": string; "Dr/Cr": string }[]).filter(
          (r) => r["Voucher Type"] === "Journal",
        );

        const invoiceJournal = journals.filter((r) => r["Voucher No"] === invoiceRow.invoice_no);
        expect(invoiceJournal.length).toBeGreaterThanOrEqual(2);

        const lateFeeJournal = journals.filter((r) => r["Voucher No"].includes("/late_fee/"));
        expect(lateFeeJournal).toHaveLength(2);
        const lateFeeCr = lateFeeJournal.find((r) => r["Dr/Cr"] === "Cr");
        expect(lateFeeCr?.["Ledger Name"]).toBe("Late Fee Income");
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("a voided payment appears as a Payment voucher", async () => {
    const inst = await createTestInstitution("fp-export-void");
    try {
      const { invoiceId } = await setupInvoice(inst, "ADM-EXP-VOID", 1500);
      const paymentId = await recordPayment(inst, invoiceId, 1500);
      await voidPayment(inst, paymentId);
      const { from, to } = dateRange();

      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        const rows = await ledgerExport(ctx, { from, to, layout: "tally", include: "receipts" });
        const voucherTypes = (rows as { "Voucher Type": string }[]).map((r) => r["Voucher Type"]);
        expect(voucherTypes).toContain("Payment");
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("feePlans.ledgerExport — plain layout (X04-T7)", () => {
  it("returns debit/credit as numbers, not strings", async () => {
    const inst = await createTestInstitution("fp-export-plain");
    try {
      const { invoiceId } = await setupInvoice(inst, "ADM-EXP-PLAIN", 1500);
      await recordPayment(inst, invoiceId, 1500);
      const { from, to } = dateRange();

      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        const rows = await ledgerExport(ctx, { from, to, layout: "plain", include: "receipts" });
        expect(rows).toHaveLength(2);
        for (const row of rows as { debit: number; credit: number }[]) {
          expect(typeof row.debit).toBe("number");
          expect(typeof row.credit).toBe("number");
        }
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("pages past PostgREST's 1,000-row default — 1,200 ledger lines all come back", async () => {
    const inst = await createTestInstitution("fp-export-paging");
    try {
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'cash', 1, 0, current_date, 'paging row ' || n
        from generate_series(1, 1200) as n
      `;
      const { from, to } = dateRange();

      const ctx = await buildContext(inst, "accountant");
      actingClient = inst.clientAs("accountant");
      try {
        const rows = await ledgerExport(ctx, { from, to, layout: "plain", include: "all" });
        expect(rows).toHaveLength(1200);
      } finally {
        actingClient = null;
      }
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("feePlans.ledgerExport over HTTP (X04-T7)", () => {
  async function tokenFor(inst: TestInstitution, role: "accountant" | "teacher"): Promise<string> {
    const { data, error } = await inst.clientAs(role).auth.getSession();
    if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
    return data.session.access_token;
  }

  function getRequest(
    institution: string,
    input: unknown,
    format: "json" | "csv",
    headers: Record<string, string>,
  ): Promise<Response> {
    const url = new URL("http://localhost/api/v1/query/feePlans.ledgerExport");
    url.searchParams.set("institution", institution);
    url.searchParams.set("input", JSON.stringify(input));
    if (format === "csv") url.searchParams.set("format", "csv");
    return GET(new Request(url, { headers }), { params: Promise.resolve({ name: "feePlans.ledgerExport" }) });
  }

  it("GET ?format=csv&layout=tally streams the Tally header row", async () => {
    const inst = await createTestInstitution("fp-export-csv");
    try {
      const { invoiceId } = await setupInvoice(inst, "ADM-EXP-CSV", 1500);
      await recordPayment(inst, invoiceId, 1500);
      const { from, to } = dateRange();
      const token = await tokenFor(inst, "accountant");

      const res = await getRequest(inst.slug, { from, to, layout: "tally" }, "csv", { authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      const body = await res.text();
      expect(body.startsWith("Date,Voucher Type,Voucher No,Ledger Name,Dr/Cr,Amount,Narration")).toBe(true);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher is forbidden", async () => {
    const inst = await createTestInstitution("fp-export-teacher");
    try {
      const { from, to } = dateRange();
      const token = await tokenFor(inst, "teacher");

      const res = await getRequest(inst.slug, { from, to, layout: "tally" }, "json", { authorization: `Bearer ${token}` });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error?: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
