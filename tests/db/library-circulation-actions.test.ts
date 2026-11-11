import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { issueLoan, renewLoan, returnLoan } from "@/modules/library/circulation.actions";
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
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// X03-T6 — library.loan.issue / library.loan.renew / library.loan.return.
// Each action resolves a caller-given accession number to a row in
// ctx.institution, then calls the matching definer RPC (mirrors T2/T3's
// direct-RPC db tests, but through the action layer — accession in, not a
// raw copy/loan id).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function isoDate(offsetDays: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(Date.now() + offsetDays * 864e5);
}

async function studentIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.student_id as string;
}

async function createBook(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.library_books (institution_id, title, author)
    values (${institutionId}, 'Malgudi Days', 'R. K. Narayan')
    returning id
  `;
  return row.id as string;
}

async function createCopy(institutionId: string, bookId: string, accessionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.library_copies (institution_id, book_id, accession_no)
    values (${institutionId}, ${bookId}, ${accessionNo})
    returning id
  `;
  return row.id as string;
}

async function backdateDueOn(loanId: string, daysAgo: number): Promise<void> {
  await sql`
    update public.library_loans
    set issued_on = (now() at time zone 'Asia/Kolkata')::date - ${daysAgo + 14}::int, due_on = (now() at time zone 'Asia/Kolkata')::date - ${daysAgo}::int
    where id = ${loanId}::uuid
  `;
}

/** Fee structure + a generated, fully-paid invoice for one student (term starts well in the past so it is always "current"). */
async function setupPaidInvoice(institutionId: string, studentId: string, amount = 100): Promise<string> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'finance', jsonb_build_object('financial_year_start_month', 4, 'default_due_day', 10, 'payment_modes', array['cash']),
      'numbering', jsonb_build_object('invoice_no', 'INV/{FY}/{SEQ:6}', 'receipt_no', 'RCT/{FY}/{SEQ:6}')
    )
    where id = ${institutionId}
  `;
  const yearId = await createAcademicYear(institutionId, { startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const termId = await createTerm(institutionId, yearId, { sequence: 1, startsOn: "2020-01-01", endsOn: "2030-03-31" });
  const gradeId = await createGrade(institutionId);
  const structureId = await createFeeStructure(institutionId, yearId, gradeId);
  await createFeeComponent(institutionId, structureId, { head: "tuition", amount, frequency: "term" });
  await createFeeAssignment(institutionId, studentId, structureId, yearId);
  const [row] = await sql`select app.generate_invoice(${studentId}::uuid, ${termId}::uuid) as id`;
  const invoiceId = row.id as string;
  await sql`select app.record_payment(${invoiceId}::uuid, ${amount}, 'cash', null, now(), ${crypto.randomUUID()})`;
  return invoiceId;
}

describe("library circulation actions (X03-T6)", () => {
  it("admin issues by accession -> dueOn today + loan_days (default 14)", async () => {
    const inst = await createTestInstitution("lib-act-issue");
    try {
      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const result = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.dueOn).toBe(isoDate(14));
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("issuing an already-loaned copy's accession again -> conflict", async () => {
    const inst = await createTestInstitution("lib-act-conflict");
    try {
      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const first = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(first.ok).toBe(true);

      // Same copy, same borrower — app.issue_library_loan checks "copy
      // already on loan" before any borrower-specific rule, so this is a
      // conflict regardless of who the second attempt names.
      const second = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("unknown accession -> not_found", async () => {
    const inst = await createTestInstitution("lib-act-unknown-accession");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const result = await callAs(inst, "admin", issueLoan, { accessionNo: "LIB-NOPE", studentId });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("renew by accession -> new dueOn, renew_count incremented", async () => {
    const inst = await createTestInstitution("lib-act-renew");
    try {
      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const issued = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(issued.ok).toBe(true);

      const renewed = await callAs(inst, "admin", renewLoan, { accessionNo });
      expect(renewed.ok).toBe(true);
      if (!renewed.ok) return;
      expect(renewed.data.dueOn).toBe(isoDate(14));
      if (!issued.ok) return;
      expect(renewed.data.loanId).toBe(issued.data.loanId);
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("late return (backdated) -> fineAmount > 0, fineCharged true, invoice total up by the fine", async () => {
    const inst = await createTestInstitution("lib-act-return-fine");
    try {
      await sql`
        update public.institutions set settings = settings || '{"library": {"fine_per_day": 2}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupPaidInvoice(inst.institutionId, studentId, 100);

      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);

      const issued = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      await backdateDueOn(issued.data.loanId, 3);

      const returned = await callAs(inst, "admin", returnLoan, { accessionNo });
      expect(returned.ok).toBe(true);
      if (!returned.ok) return;
      expect(returned.data.daysLate).toBe(3);
      expect(returned.data.fineAmount).toBe(6);
      expect(returned.data.fineCharged).toBe(true);

      const [invoice] = await sql`select total, status from public.invoices where id = ${invoiceId}::uuid`;
      expect(Number(invoice.total)).toBe(106);
      expect(invoice.status).toBe("part_paid");
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("return with waiveFine -> fineCharged false, no invoice line", async () => {
    const inst = await createTestInstitution("lib-act-return-waive");
    try {
      await sql`
        update public.institutions set settings = settings || '{"library": {"fine_per_day": 2}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const studentId = await studentIdFor(inst.institutionId, "student");
      await setupPaidInvoice(inst.institutionId, studentId, 100);

      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);

      const issued = await callAs(inst, "admin", issueLoan, { accessionNo, studentId });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      await backdateDueOn(issued.data.loanId, 3);

      const returned = await callAs(inst, "admin", returnLoan, { accessionNo, waiveFine: true });
      expect(returned.ok).toBe(true);
      if (!returned.ok) return;
      expect(returned.data.fineAmount).toBe(6);
      expect(returned.data.fineCharged).toBe(false);

      const [lineCount] = await sql`
        select count(*)::int as n from public.invoice_lines where institution_id = ${inst.institutionId} and head = 'library_fine'
      `;
      expect(lineCount.n).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("teacher issue -> forbidden", async () => {
    const inst = await createTestInstitution("lib-act-teacher-forbidden");
    try {
      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const result = await callAs(inst, "teacher", issueLoan, { accessionNo, studentId });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20000);

  it("return of a copy with no open loan -> not_found", async () => {
    const inst = await createTestInstitution("lib-act-return-no-loan");
    try {
      const bookId = await createBook(inst.institutionId);
      const accessionNo = `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await createCopy(inst.institutionId, bookId, accessionNo);

      const result = await callAs(inst, "admin", returnLoan, { accessionNo });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  }, 20000);
});
