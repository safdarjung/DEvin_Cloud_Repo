"use server";

// X03-T5 — library.book.upsert / library.copies.add / library.copy.setStatus
// (X03-tasks.md rulings; migration 0086 part 1, T2). Catalogue tables
// (library_books, library_copies) carry ordinary RLS insert/update policies
// for owner/principal/admin — no RPC needed here, unlike circulation (T6,
// RPC-only writes on library_loans). Pattern mirrors
// timetable/actions.ts's upsertRoom (throwMapped, 23505-by-name mapping).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  BookUpsertSchema,
  CopiesAddSchema,
  CopySetStatusSchema,
  type BookUpsertInput,
  type CopiesAddInput,
  type CopySetStatusInput,
} from "@/modules/library/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_CHECK_VIOLATION = "23514";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function pgCode(error: unknown): string | undefined {
  return error && typeof error === "object" ? ((error as { code?: unknown }).code as string | undefined) : undefined;
}

function pgMessage(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message ?? "");
}

export const upsertBook = defineAction({
  name: "library.book.upsert",
  module: "library",
  schema: BookUpsertSchema,
  permission: "library.manage",
  handler: async ({ id, title, author, isbn }: BookUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = { institution_id: ctx.institution.id, title, author, isbn: isbn ?? null };
    const query = id
      ? supabase.from("library_books").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("library_books").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      if (pgCode(error) === POSTGRES_UNIQUE_VIOLATION && pgMessage(error).includes("library_books_isbn_key")) {
        throw new AppError("conflict", "A book with this ISBN already exists.", { isbn: ["ISBN already in use."] });
      }
      if (pgCode(error) === POSTGRES_CHECK_VIOLATION) throw new AppError("validation_failed", "Invalid book details.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Book not found.");

    await audit(ctx, { action: "library.book.upsert", entityType: "library_book", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const addCopies = defineAction({
  name: "library.copies.add",
  module: "library",
  schema: CopiesAddSchema,
  permission: "library.manage",
  handler: async ({ bookId, accessionNos }: CopiesAddInput, ctx) => {
    const supabase = await createClient();
    // Prove the book is this institution's own before the batch insert, so
    // a cross-institution bookId fails fast with not_found rather than
    // tripping the copies' own FK-institution-match insert policy.
    const { data: book, error: bookError } = await supabase
      .from("library_books")
      .select("id")
      .eq("id", bookId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (bookError) throwMapped(bookError);
    if (!book) throw new AppError("not_found", "Book not found.");

    const rows = accessionNos.map((accessionNo) => ({
      institution_id: ctx.institution.id,
      book_id: bookId,
      accession_no: accessionNo,
    }));
    // Single multi-row insert: Postgres statement-level atomicity means one
    // conflicting accession aborts the whole batch, so no partial inserts.
    const { data, error } = await supabase.from("library_copies").insert(rows).select("id");
    if (error) {
      if (pgCode(error) === POSTGRES_UNIQUE_VIOLATION && pgMessage(error).includes("library_copies_accession_key")) {
        throw new AppError("conflict", "One or more accession numbers are already in use.", {
          accessionNos: ["Accession number already in use."],
        });
      }
      if (pgCode(error) === POSTGRES_CHECK_VIOLATION) throw new AppError("validation_failed", "Invalid accession number.");
      throwMapped(error);
    }
    const ids = (data ?? []).map((r) => r.id as string);

    await audit(ctx, {
      action: "library.copies.add",
      entityType: "library_copy",
      entityId: bookId,
      after: { count: ids.length },
    });

    return { ids };
  },
});

export const setCopyStatus = defineAction({
  name: "library.copy.setStatus",
  module: "library",
  schema: CopySetStatusSchema,
  permission: "library.manage",
  handler: async ({ copyId, status }: CopySetStatusInput, ctx) => {
    const supabase = await createClient();
    // app.guard_library_catalog raises code:conflict ("copy is on loan")
    // when withdrawing an on-loan copy — mapSqlError's code:* regex covers
    // it, no extra handling needed here.
    const { data, error } = await supabase
      .from("library_copies")
      .update({ status })
      .eq("id", copyId)
      .eq("institution_id", ctx.institution.id)
      .select("id, status")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Copy not found.");

    await audit(ctx, {
      // record_audit_event requires a lowercase dotted action string
      // (0013); the action's own name (registry/permission key, used in
      // routing and escalation.test.ts) stays camelCase per rulings.
      action: "library.copy.set_status",
      entityType: "library_copy",
      entityId: data.id as string,
      after: { status: data.status },
    });

    return { id: data.id as string, status: data.status as "active" | "withdrawn" };
  },
});
