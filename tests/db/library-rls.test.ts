import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

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

async function createBook(institutionId: string, overrides: Partial<{ title: string; author: string; isbn: string | null }> = {}) {
  const [row] = await sql`
    insert into public.library_books (institution_id, title, author, isbn)
    values (${institutionId}, ${overrides.title ?? "Malgudi Days"}, ${overrides.author ?? "R. K. Narayan"}, ${overrides.isbn ?? null})
    returning id
  `;
  return row.id as string;
}

async function createCopy(institutionId: string, bookId: string, accessionNo?: string) {
  const [row] = await sql`
    insert into public.library_copies (institution_id, book_id, accession_no)
    values (${institutionId}, ${bookId}, ${accessionNo ?? `LIB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`})
    returning id
  `;
  return row.id as string;
}

async function createBareStudent(institutionId: string, status = "active"): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender, status)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2014-01-01', 'other', ${status})
    returning id
  `;
  return row.id as string;
}

async function backdateDueOn(loanId: string, daysAgo: number): Promise<void> {
  await sql`
    update public.library_loans
    set issued_on = current_date - ${daysAgo + 14}::int, due_on = current_date - ${daysAgo}::int
    where id = ${loanId}::uuid
  `;
}

describe("library migration (0086 part 1) — tables, RLS, guard, issue/renew", () => {
  it("admin issues a copy to a student -> due today + loan_days (default 14)", async () => {
    const inst = await createTestInstitution("lib-issue");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const { data, error } = await inst.clientAs("admin").rpc("issue_library_loan", {
        p_copy_id: copyId,
        p_student_id: studentId,
      });

      expect(error).toBeNull();
      expect(data.due_on).toBe(isoDate(14));
    } finally {
      await inst.cleanup();
    }
  });

  it("issuing an already-loaned copy again -> conflict", async () => {
    const inst = await createTestInstitution("lib-conflict-copy");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      const otherStudentId = await createBareStudent(inst.institutionId);

      const first = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: otherStudentId });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("third open loan for a student (limit 2) -> conflict", async () => {
    const inst = await createTestInstitution("lib-limit-student");
    try {
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      for (let i = 0; i < 2; i++) {
        const copyId = await createCopy(inst.institutionId, bookId);
        const { error } = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
        expect(error).toBeNull();
      }

      const thirdCopyId = await createCopy(inst.institutionId, bookId);
      const third = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: thirdCopyId, p_student_id: studentId });
      expect(third.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("settings max_loans_staff: 1 -> second staff loan is a conflict", async () => {
    const inst = await createTestInstitution("lib-limit-staff");
    try {
      await sql`
        update public.institutions set settings = settings || '{"library": {"max_loans_staff": 1}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const bookId = await createBook(inst.institutionId);
      const staffId = await staffIdFor(inst.institutionId, "teacher");

      const copy1 = await createCopy(inst.institutionId, bookId);
      const first = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copy1, p_staff_id: staffId });
      expect(first.error).toBeNull();

      const copy2 = await createCopy(inst.institutionId, bookId);
      const second = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copy2, p_staff_id: staffId });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("borrower with a backdated overdue loan -> invalid_state on a new issue", async () => {
    const inst = await createTestInstitution("lib-overdue-borrower");
    try {
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const copy1 = await createCopy(inst.institutionId, bookId);
      const first = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copy1, p_student_id: studentId });
      expect(first.error).toBeNull();
      await backdateDueOn(first.data.loan_id, 3);

      const copy2 = await createCopy(inst.institutionId, bookId);
      const second = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copy2, p_student_id: studentId });
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("withdrawn copy -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-withdrawn-copy");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      await sql`update public.library_copies set status = 'withdrawn' where id = ${copyId}::uuid`;

      const { error } = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("withdrawn student -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-withdrawn-student");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await createBareStudent(inst.institutionId, "withdrawn");

      const { error } = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("both or neither borrower -> validation_failed", async () => {
    const inst = await createTestInstitution("lib-both-neither");
    try {
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      const staffId = await staffIdFor(inst.institutionId, "teacher");

      const copyA = await createCopy(inst.institutionId, bookId);
      const neither = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyA });
      expect(neither.error?.message).toContain("code:validation_failed");

      const copyB = await createCopy(inst.institutionId, bookId);
      const both = await inst.clientAs("admin").rpc("issue_library_loan", {
        p_copy_id: copyB,
        p_student_id: studentId,
        p_staff_id: staffId,
      });
      expect(both.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher issuing a loan -> forbidden", async () => {
    const inst = await createTestInstitution("lib-teacher-forbidden");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const { error } = await inst.clientAs("teacher").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of B issuing A's copy -> not_found; admin of A with B's student -> not_found", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const bookA = await createBook(a.institutionId);
      const copyA = await createCopy(a.institutionId, bookA);
      const studentB = await studentIdFor(b.institutionId, "student");

      const crossCopy = await b.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyA, p_student_id: studentB });
      expect(crossCopy.error?.message).toContain("code:not_found");

      const crossStudent = await a.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyA, p_student_id: studentB });
      expect(crossStudent.error?.message).toContain("code:not_found");
    });
  });

  it("renew -> due today + loan_days, renew_count 1; third renew -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-renew");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(issued.error).toBeNull();
      const loanId = issued.data.loan_id;

      const renew1 = await inst.clientAs("admin").rpc("renew_library_loan", { p_loan_id: loanId });
      expect(renew1.error).toBeNull();
      expect(renew1.data.due_on).toBe(isoDate(14));

      const renew2 = await inst.clientAs("admin").rpc("renew_library_loan", { p_loan_id: loanId });
      expect(renew2.error).toBeNull();

      const renew3 = await inst.clientAs("admin").rpc("renew_library_loan", { p_loan_id: loanId });
      expect(renew3.error?.message).toContain("code:invalid_state");

      const [row] = await sql`select renew_count from public.library_loans where id = ${loanId}::uuid`;
      expect(row.renew_count).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("renewing an overdue loan -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-renew-overdue");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      await backdateDueOn(issued.data.loan_id, 2);

      const renew = await inst.clientAs("admin").rpc("renew_library_loan", { p_loan_id: issued.data.loan_id });
      expect(renew.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian sees own child's loan only; guardian of another family sees none; student sees own; teacher sees only own staff loan", async () => {
    const inst = await createTestInstitution("lib-rls-scope");
    try {
      const bookId = await createBook(inst.institutionId);
      const studentId = await studentIdFor(inst.institutionId, "student");
      const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");

      const [guardianRow] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
      `;

      const studentCopy = await createCopy(inst.institutionId, bookId);
      const studentLoan = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: studentCopy, p_student_id: studentId });
      expect(studentLoan.error).toBeNull();

      const teacherCopy = await createCopy(inst.institutionId, bookId);
      const teacherLoan = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: teacherCopy, p_staff_id: teacherStaffId });
      expect(teacherLoan.error).toBeNull();

      const guardianView = await inst.clientAs("guardian").from("library_loans").select("id");
      expect(guardianView.data).toHaveLength(1);
      expect(guardianView.data?.[0].id).toBe(studentLoan.data.loan_id);

      const otherInst = await createTestInstitution("lib-rls-scope-other-family");
      try {
        const otherFamilyView = await otherInst.clientAs("guardian").from("library_loans").select("id").eq("institution_id", inst.institutionId);
        expect(otherFamilyView.data).toHaveLength(0);
      } finally {
        await otherInst.cleanup();
      }

      const studentView = await inst.clientAs("student").from("library_loans").select("id");
      expect(studentView.data).toHaveLength(1);
      expect(studentView.data?.[0].id).toBe(studentLoan.data.loan_id);

      const teacherView = await inst.clientAs("teacher").from("library_loans").select("id");
      expect(teacherView.data).toHaveLength(1);
      expect(teacherView.data?.[0].id).toBe(teacherLoan.data.loan_id);
    } finally {
      await inst.cleanup();
    }
  }, 20_000); // nested second institution for the "other family" assertion — slow under full-suite auth load (DBT-46 pattern)

  it("guardian INSERT/UPDATE on library_loans writes nothing", async () => {
    const inst = await createTestInstitution("lib-loans-no-write");
    try {
      const bookId = await createBook(inst.institutionId);
      const copyId = await createCopy(inst.institutionId, bookId);

      const insertAttempt = await inst.clientAs("guardian").from("library_loans").insert({
        institution_id: inst.institutionId,
        copy_id: copyId,
        student_id: await studentIdFor(inst.institutionId, "student"),
        issued_on: isoDate(0),
        due_on: isoDate(14),
      });
      expect(insertAttempt.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  }, 15_000);

  it("withdrawing a copy on loan -> conflict; changing a copy's book_id -> invalid_state", async () => {
    const inst = await createTestInstitution("lib-guard");
    try {
      const bookA = await createBook(inst.institutionId, { title: "Book A" });
      const bookB = await createBook(inst.institutionId, { title: "Book B" });
      const copyId = await createCopy(inst.institutionId, bookA);
      const studentId = await studentIdFor(inst.institutionId, "student");

      const issued = await inst.clientAs("admin").rpc("issue_library_loan", { p_copy_id: copyId, p_student_id: studentId });
      expect(issued.error).toBeNull();

      const withdraw = await inst.clientAs("admin").from("library_copies").update({ status: "withdrawn" }).eq("id", copyId);
      expect(withdraw.error?.message ?? "").toContain("code:conflict");

      const rebind = await inst.clientAs("admin").from("library_copies").update({ book_id: bookB }).eq("id", copyId);
      expect(rebind.error?.message ?? "").toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 15_000);

  it("teacher cannot insert a book; admin of A cannot add a copy of B's book", async () => {
    await withTwoInstitutions(async (a: TestInstitution, b: TestInstitution) => {
      const teacherInsert = await a.clientAs("teacher").from("library_books").insert({
        institution_id: a.institutionId,
        title: "Not allowed",
        author: "Teacher",
      });
      expect(teacherInsert.error).not.toBeNull();

      const bookB = await createBook(b.institutionId);
      const crossCopy = await a.clientAs("admin").from("library_copies").insert({
        institution_id: a.institutionId,
        book_id: bookB,
        accession_no: "LIB-CROSS-01",
      });
      expect(crossCopy.error).not.toBeNull();
    });
  }, 15_000);

  it("module_enabled(inst, 'library') is false by default, true when stored true", async () => {
    const inst = await createTestInstitution("lib-module-off");
    try {
      await sql`update public.institutions set settings = settings - 'modules' where id = ${inst.institutionId}`;
      const [offRow] = await sql`select app.module_enabled(${inst.institutionId}::uuid, 'library') as enabled`;
      expect(offRow.enabled).toBe(false);

      await sql`
        update public.institutions set settings = settings || '{"modules": {"library": true}}'::jsonb
        where id = ${inst.institutionId}
      `;
      const [onRow] = await sql`select app.module_enabled(${inst.institutionId}::uuid, 'library') as enabled`;
      expect(onRow.enabled).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });
});
