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
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function studentIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.student_id as string;
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function createBook(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.library_books (institution_id, title, author)
    values (${institutionId}, 'Malgudi Days', 'R. K. Narayan')
    returning id
  `;
  return row.id as string;
}

async function createCopy(institutionId: string, bookId: string): Promise<string> {
  const [row] = await sql`
    insert into public.library_copies (institution_id, book_id, accession_no)
    values (${institutionId}, ${bookId}, ${`LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`})
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

/** Fee structure + a generated, fully-payable invoice for one student (term starts well in the past so it is always "current"). */
async function setupInvoice(institutionId: string, studentId: string, amount = 100): Promise<string> {
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
  return row.id as string;
}

async function payInFull(institutionId: string, invoiceId: string, amount: number): Promise<void> {
  await sql`
    select app.record_payment(${invoiceId}::uuid, ${amount}, 'cash', null, now(), ${crypto.randomUUID()})
  `;
  const [row] = await sql`select status from public.invoices where id = ${invoiceId}::uuid`;
  if (row.status !== "paid") throw new Error(`expected invoice to be paid, got ${row.status}`);
}

describe("library migration (0086 part 2) — app.add_invoice_charge + return_library_loan", () => {
  it("on-time return -> fine 0, no invoice line", async () => {
    const inst = await createTestInstitution("lib-return-ontime");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(issued.error).toBeNull();

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error).toBeNull();
      expect(returned.data.days_late).toBe(0);
      expect(returned.data.fine_amount).toBe(0);
      expect(returned.data.fine_waived).toBe(false);
      expect(returned.data.invoice_line_id).toBeNull();

      const [lineCount] = await sql`
        select count(*)::int as n from public.invoice_lines where institution_id = ${inst.institutionId} and head = 'library_fine'
      `;
      expect(lineCount.n).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("fine_per_day 2, 3 days late -> fine 6.00, one library_fine line, invoice total +6, paid -> part_paid, ledger balanced", async () => {
    const inst = await createTestInstitution("lib-return-fine");
    try {
      await sql`
        update public.institutions set settings = settings || '{"library": {"fine_per_day": 2}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupInvoice(inst.institutionId, studentId, 100);
      await payInFull(inst.institutionId, invoiceId, 100);

      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(issued.error).toBeNull();
      await backdateDueOn(issued.data.loan_id, 3);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error).toBeNull();
      expect(returned.data.days_late).toBe(3);
      expect(returned.data.fine_amount).toBe(6);
      expect(returned.data.invoice_line_id).not.toBeNull();

      const [invoice] = await sql`select total, status from public.invoices where id = ${invoiceId}::uuid`;
      expect(Number(invoice.total)).toBe(106);
      expect(invoice.status).toBe("part_paid");

      const lines = await sql`
        select head, amount from public.invoice_lines where invoice_id = ${invoiceId}::uuid and head = 'library_fine'
      `;
      expect(lines).toHaveLength(1);
      expect(Number(lines[0].amount)).toBe(6);

      const [balance] = await sql`
        select coalesce(sum(debit), 0)::numeric as debit, coalesce(sum(credit), 0)::numeric as credit
        from public.ledger_entries where institution_id = ${inst.institutionId}
      `;
      expect(Number(balance.debit)).toBe(Number(balance.credit));
    } finally {
      await inst.cleanup();
    }
  });

  it("default settings -> fine_per_day 1", async () => {
    const inst = await createTestInstitution("lib-return-default-rate");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupInvoice(inst.institutionId, studentId, 50);
      await payInFull(inst.institutionId, invoiceId, 50);

      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      await backdateDueOn(issued.data.loan_id, 4);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error).toBeNull();
      expect(returned.data.fine_amount).toBe(4);
    } finally {
      await inst.cleanup();
    }
  });

  it("waiveFine -> fine stored, fine_waived true, no line, no ledger rows", async () => {
    const inst = await createTestInstitution("lib-return-waive");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      await backdateDueOn(issued.data.loan_id, 2);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id, p_waive_fine: true });
      expect(returned.error).toBeNull();
      expect(returned.data.fine_amount).toBe(2);
      expect(returned.data.fine_waived).toBe(true);
      expect(returned.data.invoice_line_id).toBeNull();

      const [lineCount] = await sql`
        select count(*)::int as n from public.invoice_lines where institution_id = ${inst.institutionId} and head = 'library_fine'
      `;
      expect(lineCount.n).toBe(0);
      const [ledgerCount] = await sql`
        select count(*)::int as n from public.ledger_entries where institution_id = ${inst.institutionId} and account = 'fee_income'
      `;
      expect(ledgerCount.n).toBe(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("late staff loan -> fine 0", async () => {
    const inst = await createTestInstitution("lib-return-staff");
    try {
      const staffId = await staffIdFor(inst.institutionId, "teacher");
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_staff_id: staffId });
      await backdateDueOn(issued.data.loan_id, 5);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error).toBeNull();
      expect(returned.data.fine_amount).toBe(0);
      expect(returned.data.fine_waived).toBe(false);
      expect(returned.data.invoice_line_id).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("student with no non-cancelled invoice -> invalid_state, loan stays open", async () => {
    const inst = await createTestInstitution("lib-return-no-invoice");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      await backdateDueOn(issued.data.loan_id, 2);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error?.message).toContain("code:invalid_state");

      const [loan] = await sql`select returned_on from public.library_loans where id = ${issued.data.loan_id}::uuid`;
      expect(loan.returned_on).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("return twice -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-return-twice");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });

      const first = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher returning a loan -> forbidden", async () => {
    const inst = await createTestInstitution("lib-return-teacher-forbidden");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });

      const { error } = await inst.clientAs("teacher").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of another institution returning a loan -> not_found", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const studentA = await studentIdFor(a.institutionId, "student");
      const bookA = await createBook(a.institutionId);
      const copyA = await createCopy(a.institutionId, bookA);
      const issued = await a.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyA, p_student_id: studentA });
      expect(issued.error).toBeNull();

      const { error } = await b.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(error?.message).toContain("code:not_found");
    });
  }, 15_000); // nested second institution — slow under full-suite auth load (DBT-46 pattern)

  it("authenticated calling add_invoice_charge over PostgREST -> no accessible function", async () => {
    const inst = await createTestInstitution("lib-add-charge-postgrest");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupInvoice(inst.institutionId, studentId, 50);

      const { error } = await inst.clientAs("admin").rpc("add_invoice_charge", {
        p_invoice_id: invoiceId,
        p_head: "library_fine",
        p_description: "test",
        p_amount: 5,
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("charge on a cancelled invoice (postgres sql client) -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-add-charge-cancelled");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupInvoice(inst.institutionId, studentId, 50);
      await sql`update public.invoices set status = 'cancelled' where id = ${invoiceId}::uuid`;

      await expect(
        sql`select app.add_invoice_charge(${invoiceId}::uuid, 'library_fine', 'test', 5)`,
      ).rejects.toThrow(/code:invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian reads the fine line on own child's invoice", async () => {
    const inst = await createTestInstitution("lib-return-guardian-reads-fine");
    try {
      const studentId = await studentIdFor(inst.institutionId, "student");
      const invoiceId = await setupInvoice(inst.institutionId, studentId, 50);

      const [guardianRow] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
      `;

      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      await backdateDueOn(issued.data.loan_id, 2);

      const returned = await inst.clientAs("admin").rpc("return_library_loan", { p_loan_id: issued.data.loan_id });
      expect(returned.error).toBeNull();
      expect(returned.data.fine_amount).toBe(2);

      const guardianLines = await inst.clientAs("guardian").from("invoice_lines").select("head, amount").eq("invoice_id", invoiceId);
      expect(guardianLines.error).toBeNull();
      const fineLine = guardianLines.data?.find((l) => l.head === "library_fine");
      expect(fineLine).toBeDefined();
      expect(Number(fineLine?.amount)).toBe(2);
    } finally {
      await inst.cleanup();
    }
  }, 15_000);
});
