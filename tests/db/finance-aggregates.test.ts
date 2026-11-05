import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (same shape as tests/db/payments.test.ts) — only this file's
// module graph gets them.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { listLedgerEntries, termCollectionSummary } from "@/modules/finance/queries";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// DBT-40 (M12-T2): diagnose confirmed the demo tenant's books are balanced
// in SQL (count ~20.7k rows, sum(debit) - sum(credit) = 0); the old
// `listLedgerEntries`/`termCollectionSummary` summed an un-`.range()`'d
// PostgREST select, silently truncated to `max_rows = 1000`
// (supabase/config.toml). These tests seed over 1,000 rows directly via
// `sql` (bulk, bypassing the app) so a correct fix must sum every row via
// the new `ledger_totals`/`term_collection_totals` SQL functions, not a
// client-side reduce over a capped page.
describe("ledger_totals / listLedgerEntries over 1,000 rows (DBT-40)", () => {
  it("balances total debit and total credit across 1,200 rows (600 Dr inserted before 600 Cr)", async () => {
    const inst = await createTestInstitution("ledger-aggregate");
    try {
      const entryDate = "2026-01-15";
      // 600 Dr rows (fees_receivable) inserted first, then 600 Cr rows
      // (cash) — order matters nothing to a SQL sum, but did matter to the
      // old unordered 1,000-row PostgREST slice this replaces.
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'fees_receivable', 100.00, 0, ${entryDate}::date, 'DBT-40 dr ' || g
        from generate_series(1, 600) as g
      `;
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'cash', 0, 100.00, ${entryDate}::date, 'DBT-40 cr ' || g
        from generate_series(1, 600) as g
      `;

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const ledger = await listLedgerEntries(ctx, { from: entryDate, to: entryDate }, 1, 50);
        expect(ledger.totalDebit).toBe(60000);
        expect(ledger.totalCredit).toBe(60000);
        expect(ledger.balanced).toBe(true);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("account filter sums that account only, not the whole range", async () => {
    const inst = await createTestInstitution("ledger-aggregate-account");
    try {
      const entryDate = "2026-01-16";
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'fees_receivable', 100.00, 0, ${entryDate}::date, 'DBT-40 dr ' || g
        from generate_series(1, 600) as g
      `;
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'cash', 0, 100.00, ${entryDate}::date, 'DBT-40 cr ' || g
        from generate_series(1, 600) as g
      `;

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const cashOnly = await listLedgerEntries(ctx, { from: entryDate, to: entryDate, account: "cash" }, 1, 50);
        expect(cashOnly.totalDebit).toBe(0);
        expect(cashOnly.totalCredit).toBe(60000);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling ledger_totals directly over PostgREST gets 0/0 (RLS, not an error)", async () => {
    const inst = await createTestInstitution("ledger-aggregate-rls");
    try {
      const entryDate = "2026-01-17";
      await sql`
        insert into public.ledger_entries (institution_id, account, debit, credit, entry_date, memo)
        select ${inst.institutionId}, 'fees_receivable', 100.00, 0, ${entryDate}::date, 'DBT-40 dr ' || g
        from generate_series(1, 600) as g
      `;

      const { data, error } = await inst
        .clientAs("teacher")
        .rpc("ledger_totals", { p_institution_id: inst.institutionId, p_from: entryDate, p_to: entryDate });
      expect(error).toBeNull();
      expect(data).toEqual([{ total_debit: 0, total_credit: 0 }]);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("term_collection_totals / termCollectionSummary over 1,000 invoices (DBT-40)", () => {
  it("counts 1,001 invoices in one term with exact paise totals", async () => {
    const inst = await createTestInstitution("term-aggregate-overpage");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId, { sequence: 1 });

      // Bulk SQL (bypassing generate_invoice/students factory) — only needs
      // to clear PostgREST's 1,000-row default page, same precedent as
      // tests/db/invoice-generation.test.ts's STUDENT_COUNT = 1001 case.
      const INVOICE_COUNT = 1001;
      await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        select ${inst.institutionId}, 'ADM-AGG-' || g, 'Test', '2015-01-01', 'other'
        from generate_series(1, ${INVOICE_COUNT}) as g
      `;
      await sql`
        insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, total, paid_total)
        select ${inst.institutionId}, s.id, ${yearId}::uuid, ${termId}::uuid, 'INV-AGG-' || row_number() over (order by s.id), 100.00, 40.00
        from public.students s
        where s.institution_id = ${inst.institutionId} and s.admission_no like 'ADM-AGG-%'
      `;

      const ctx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const summary = await termCollectionSummary(ctx, termId);
        expect(summary.invoiceCount).toBe(INVOICE_COUNT);
        expect(summary.duePaise).toBe(INVOICE_COUNT * 10000);
        expect(summary.collectedPaise).toBe(INVOICE_COUNT * 4000);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 60_000);
});
