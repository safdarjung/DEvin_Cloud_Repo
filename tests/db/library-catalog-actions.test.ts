import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addCopies, setCopyStatus, upsertBook } from "@/modules/library/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// X03-T5 — library.book.upsert / library.copies.add / library.copy.setStatus.
// Catalogue writes go through ordinary RLS (owner/principal/admin), not an
// RPC — conflicts are the tables' own unique constraints (23505) and the
// withdraw guard (app.guard_library_catalog, code:conflict), not an RPC's
// caller check.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

describe("library catalog actions (X03-T5)", () => {
  it("admin adds a book with ISBN and 3 copies", async () => {
    const inst = await createTestInstitution("library-catalog-happy");
    try {
      const book = await callAs(inst, "admin", upsertBook, {
        title: "Malgudi Days",
        author: "R. K. Narayan",
        isbn: "978-81-7371-146-6",
      });
      expect(book.ok).toBe(true);
      if (!book.ok) return;

      const copies = await callAs(inst, "admin", addCopies, {
        bookId: book.data.id,
        accessionNos: ["LIB-0001", "LIB-0002", "LIB-0003"],
      });
      expect(copies.ok).toBe(true);
      if (!copies.ok) return;
      expect(copies.data.ids).toHaveLength(3);
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("same ISBN again → conflict with fieldErrors.isbn", async () => {
    const inst = await createTestInstitution("library-catalog-isbn-conflict");
    try {
      const first = await callAs(inst, "admin", upsertBook, { title: "Book A", author: "Author A", isbn: "9788173711466" });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "admin", upsertBook, { title: "Book B", author: "Author B", isbn: "9788173711466" });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
      expect(second.error.fieldErrors?.isbn).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("a batch with one used accession → conflict with fieldErrors.accessionNos and zero copies inserted", async () => {
    const inst = await createTestInstitution("library-catalog-accession-conflict");
    try {
      const book = await callAs(inst, "admin", upsertBook, { title: "Book A", author: "Author A" });
      if (!book.ok) throw new Error("setup: upsertBook failed");

      const first = await callAs(inst, "admin", addCopies, { bookId: book.data.id, accessionNos: ["LIB-0010"] });
      if (!first.ok) throw new Error("setup: addCopies failed");

      const second = await callAs(inst, "admin", addCopies, {
        bookId: book.data.id,
        accessionNos: ["LIB-0011", "LIB-0010", "LIB-0012"],
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
      expect(second.error.fieldErrors?.accessionNos).toBeDefined();

      const [{ count }] = await sql`
        select count(*)::int as count from public.library_copies
        where institution_id = ${inst.institutionId} and accession_no in ('LIB-0011', 'LIB-0012')
      `;
      expect(count).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("teacher → forbidden", async () => {
    const inst = await createTestInstitution("library-catalog-teacher-forbidden");
    try {
      const result = await callAs(inst, "teacher", upsertBook, { title: "Book A", author: "Author A" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("another institution's bookId → not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const bookA = await callAs(a, "admin", upsertBook, { title: "Book A", author: "Author A" });
      if (!bookA.ok) throw new Error("setup: upsertBook failed");

      const result = await callAs(b, "admin", addCopies, { bookId: bookA.data.id, accessionNos: ["LIB-0020"] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });
  }, 25000);

  it("withdrawing a copy on loan → conflict", async () => {
    const inst = await createTestInstitution("library-catalog-withdraw-onloan");
    try {
      const book = await callAs(inst, "admin", upsertBook, { title: "Book A", author: "Author A" });
      if (!book.ok) throw new Error("setup: upsertBook failed");
      const copies = await callAs(inst, "admin", addCopies, { bookId: book.data.id, accessionNos: ["LIB-0030"] });
      if (!copies.ok) throw new Error("setup: addCopies failed");
      const copyId = copies.data.ids[0];

      const studentId = await studentIdFor(inst.institutionId);
      const { error: issueError } = await inst.clientAs("admin").rpc("issue_library_loan", {
        p_copy_id: copyId,
        p_student_id: studentId,
      });
      expect(issueError).toBeNull();

      const result = await callAs(inst, "admin", setCopyStatus, { copyId, status: "withdrawn" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("conflict");
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("withdraw then reactivate a free copy", async () => {
    const inst = await createTestInstitution("library-catalog-withdraw-reactivate");
    try {
      const book = await callAs(inst, "admin", upsertBook, { title: "Book A", author: "Author A" });
      if (!book.ok) throw new Error("setup: upsertBook failed");
      const copies = await callAs(inst, "admin", addCopies, { bookId: book.data.id, accessionNos: ["LIB-0040"] });
      if (!copies.ok) throw new Error("setup: addCopies failed");
      const copyId = copies.data.ids[0];

      const withdrawn = await callAs(inst, "admin", setCopyStatus, { copyId, status: "withdrawn" });
      expect(withdrawn.ok).toBe(true);
      if (!withdrawn.ok) return;
      expect(withdrawn.data.status).toBe("withdrawn");

      const reactivated = await callAs(inst, "admin", setCopyStatus, { copyId, status: "active" });
      expect(reactivated.ok).toBe(true);
      if (!reactivated.ok) return;
      expect(reactivated.data.status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  }, 25000);

  it("title update keeps the id", async () => {
    const inst = await createTestInstitution("library-catalog-title-update");
    try {
      const created = await callAs(inst, "admin", upsertBook, { title: "Old Title", author: "Author A" });
      if (!created.ok) throw new Error("setup: upsertBook failed");

      const updated = await callAs(inst, "admin", upsertBook, {
        id: created.data.id,
        title: "New Title",
        author: "Author A",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.id).toBe(created.data.id);

      const [row] = await sql`select title from public.library_books where id = ${created.data.id}`;
      expect(row.title).toBe("New Title");
    } finally {
      await inst.cleanup();
    }
  }, 25000);
});
