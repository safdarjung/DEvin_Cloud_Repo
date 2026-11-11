// X03-T7 — src/modules/library/queries.ts, called directly as plain
// query functions (buildContext + setActingClient pattern), plus the
// query-defs.ts wrapper via callAs for the permission-gate case. Mirrors
// tests/db/transport-queries.test.ts / tests/db/timetable-queries.test.ts.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { libraryCatalog, libraryMyLoans, libraryOverdue } from "@/modules/library/queries";
import { libraryOverdueQuery } from "@/modules/library/query-defs";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.student_id as string;
}

async function createBareStudent(institutionId: string, status = "active"): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender, status)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2014-01-01', 'other', ${status})
    returning id
  `;
  return row.id as string;
}

async function createBook(institutionId: string, overrides: Partial<{ title: string; author: string; isbn: string | null }> = {}) {
  const [row] = await sql`
    insert into public.library_books (institution_id, title, author, isbn)
    values (${institutionId}, ${overrides.title ?? "Malgudi Days"}, ${overrides.author ?? "R. K. Narayan"}, ${overrides.isbn ?? null})
    returning id
  `;
  return row.id as string;
}

async function createCopy(institutionId: string, bookId: string, status: "active" | "withdrawn" = "active"): Promise<string> {
  const [row] = await sql`
    insert into public.library_copies (institution_id, book_id, accession_no, status)
    values (${institutionId}, ${bookId}, ${`LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`}, ${status})
    returning id
  `;
  return row.id as string;
}

async function issueLoan(inst: TestInstitution, copyId: string, borrower: { studentId?: string; staffId?: string }) {
  const { data, error } = await inst.clientAs("admin").rpc("issue_library_loan", {
    p_copy_id: copyId,
    p_student_id: borrower.studentId ?? null,
    p_staff_id: borrower.staffId ?? null,
  });
  if (error) throw error;
  return data.loan_id as string;
}

async function backdateDueOn(loanId: string, daysAgo: number): Promise<void> {
  await sql`
    update public.library_loans
    set issued_on = (now() at time zone 'Asia/Kolkata')::date - ${daysAgo + 14}::int, due_on = (now() at time zone 'Asia/Kolkata')::date - ${daysAgo}::int
    where id = ${loanId}::uuid
  `;
}

describe("library.catalog", () => {
  it("counts copies/available with one copy on loan and one withdrawn", async () => {
    const inst = await createTestInstitution("lib-q-catalog-counts");
    try {
      const bookId = await createBook(inst.institutionId, { title: "Chemp Chemp" });
      const onLoanCopy = await createCopy(inst.institutionId, bookId);
      await createCopy(inst.institutionId, bookId, "withdrawn");
      await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      await issueLoan(inst, onLoanCopy, { studentId });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const rows = await libraryCatalog(ctx, {});
        const row = rows.find((r) => r.id === bookId);
        expect(row?.copies).toBe(2); // active only: onLoanCopy + the extra active copy, withdrawn excluded
        expect(row?.available).toBe(1); // onLoanCopy has an open loan
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("q 'malgudi' matches case-insensitively; a literal % matches nothing extra", async () => {
    const inst = await createTestInstitution("lib-q-catalog-search");
    try {
      await createBook(inst.institutionId, { title: "Malgudi Days", author: "R. K. Narayan" });
      await createBook(inst.institutionId, { title: "Wings of Fire", author: "A. P. J. Abdul Kalam" });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const matched = await libraryCatalog(ctx, { q: "MALgudi" });
        expect(matched).toHaveLength(1);
        expect(matched[0]?.title).toBe("Malgudi Days");

        // Unescaped, a bare "%" ilike pattern would match every row (wildcard).
        // escapeIlike must neutralise it so a literal "%" matches nothing here.
        const literalPercent = await libraryCatalog(ctx, { q: "%" });
        expect(literalPercent).toHaveLength(0);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});

describe("library.overdue", () => {
  it("lists a backdated student loan with daysOverdue/fineSoFar at settings fine_per_day=2, and a staff loan with fineSoFar 0", async () => {
    const inst = await createTestInstitution("lib-q-overdue");
    try {
      await sql`
        update public.institutions set settings = settings || '{"library": {"fine_per_day": 2}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const studentCopy = await createCopy(inst.institutionId, bookId);
      const studentLoanId = await issueLoan(inst, studentCopy, { studentId });
      await backdateDueOn(studentLoanId, 5);

      const staffCopy = await createCopy(inst.institutionId, bookId);
      const staffLoanId = await issueLoan(inst, staffCopy, { staffId: teacherStaffId });
      await backdateDueOn(staffLoanId, 3);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const rows = await libraryOverdue(ctx, {});
        const studentRow = rows.find((r) => r.loanId === studentLoanId);
        const staffRow = rows.find((r) => r.loanId === staffLoanId);

        expect(studentRow?.borrowerKind).toBe("student");
        expect(studentRow?.daysOverdue).toBe(5);
        expect(studentRow?.fineSoFar).toBe(1000); // 5 days x Rs2/day x 100 paise

        expect(staffRow?.borrowerKind).toBe("staff");
        expect(staffRow?.daysOverdue).toBe(3);
        expect(staffRow?.fineSoFar).toBe(0); // staff are fine-exempt
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 15_000);

  it("teacher calling library.overdue -> forbidden (library.manage required at the query gate)", async () => {
    const inst = await createTestInstitution("lib-q-overdue-forbidden");
    try {
      const result = await callAs(inst, "teacher", libraryOverdueQuery, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("library.myLoans", () => {
  it("guardian sees only her own child's loans", async () => {
    const inst = await createTestInstitution("lib-q-myloans-guardian");
    try {
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      const [guardianRow] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
      `;

      const copyId = await createCopy(inst.institutionId, bookId);
      const loanId = await issueLoan(inst, copyId, { studentId });

      const otherStudentId = await createBareStudent(inst.institutionId);
      const otherCopy = await createCopy(inst.institutionId, bookId);
      await issueLoan(inst, otherCopy, { studentId: otherStudentId });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const own = await libraryMyLoans(ctx, {});
        expect(own).toHaveLength(1);
        expect(own[0]?.loanId).toBe(loanId);

        const otherFamily = await libraryMyLoans(ctx, { studentId: otherStudentId });
        expect(otherFamily).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 15_000);

  it("teacher sees only her own staff loan", async () => {
    const inst = await createTestInstitution("lib-q-myloans-teacher");
    try {
      const bookId = await createBook(inst.institutionId);
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
      const studentId = await studentIdFor(inst.institutionId, "student");

      const teacherCopy = await createCopy(inst.institutionId, bookId);
      const teacherLoanId = await issueLoan(inst, teacherCopy, { staffId: teacherStaffId });

      const studentCopy = await createCopy(inst.institutionId, bookId);
      await issueLoan(inst, studentCopy, { studentId });

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const rows = await libraryMyLoans(ctx, {});
        expect(rows).toHaveLength(1);
        expect(rows[0]?.loanId).toBe(teacherLoanId);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 15_000);
});
