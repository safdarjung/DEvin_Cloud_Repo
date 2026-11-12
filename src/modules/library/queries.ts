import "server-only";
// X03-T7 — library.catalog / library.overdue / library.myLoans reads
// (X03-tasks.md header rulings + Task 7 block). escapeIlike/quoteOrValue
// copied locally from src/modules/people/queries.ts per the packet (never
// edit that file). todayInInstitutionTimezone is M08's export from
// src/modules/attendance/queries.ts, same import other modules use.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { librarySettings } from "./schemas";
import { escapeIlike } from "@/lib/list-search";


function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Calendar-day difference `toIso - fromIso` (UTC date math, no tz shift), clamped to >= 0. */
function daysOverdueOf(dueOnIso: string, todayIso: string): number {
  const [fy, fm, fd] = dueOnIso.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
  return Math.max(0, diff);
}

export interface LibraryBookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  copies: number;
  available: number;
}

/**
 * The catalogue: one row per book with active-copy and available-copy
 * counts (available = active copies with no open loan). `q` matches title
 * or author (escaped ilike) or the normalised ISBN exactly.
 */
export async function libraryCatalog(ctx: TenantContext, input: { q?: string; limit?: number }): Promise<LibraryBookRow[]> {
  const supabase = await createClient();
  const limit = input.limit ?? 50;

  let query = supabase
    .from("library_books")
    .select("id, title, author, isbn")
    .eq("institution_id", ctx.institution.id)
    .order("title")
    .limit(limit);

  const trimmed = input.q?.trim();
  if (trimmed) {
    const term = quoteOrValue(`%${escapeIlike(trimmed)}%`);
    const normalisedIsbn = trimmed.replace(/[-\s]/g, "").toUpperCase();
    query = query.or(`title.ilike.${term},author.ilike.${term},isbn.eq.${quoteOrValue(normalisedIsbn)}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const books = data ?? [];
  if (books.length === 0) return [];

  const bookIds = books.map((b) => b.id);
  const { data: copyRows, error: copyError } = await supabase
    .from("library_copies")
    .select("id, book_id")
    .eq("institution_id", ctx.institution.id)
    .in("book_id", bookIds)
    .eq("status", "active");
  if (copyError) throw copyError;
  const copies = copyRows ?? [];

  let onLoan = new Set<string>();
  const copyIds = copies.map((c) => c.id);
  if (copyIds.length > 0) {
    const { data: loanRows, error: loanError } = await supabase
      .from("library_loans")
      .select("copy_id")
      .in("copy_id", copyIds)
      .is("returned_on", null);
    if (loanError) throw loanError;
    onLoan = new Set((loanRows ?? []).map((l) => l.copy_id));
  }

  const copyCountByBook = new Map<string, number>();
  const availableCountByBook = new Map<string, number>();
  for (const copy of copies) {
    copyCountByBook.set(copy.book_id, (copyCountByBook.get(copy.book_id) ?? 0) + 1);
    if (!onLoan.has(copy.id)) {
      availableCountByBook.set(copy.book_id, (availableCountByBook.get(copy.book_id) ?? 0) + 1);
    }
  }

  return books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    isbn: b.isbn,
    copies: copyCountByBook.get(b.id) ?? 0,
    available: availableCountByBook.get(b.id) ?? 0,
  }));
}

export interface LibraryOverdueRow {
  loanId: string;
  accessionNo: string;
  title: string;
  borrowerKind: "student" | "staff";
  borrowerId: string;
  borrowerName: string;
  borrowerRef: string;
  issuedOn: string;
  dueOn: string;
  daysOverdue: number;
  fineSoFar: number;
}

interface OverdueLoanRow {
  id: string;
  issued_on: string;
  due_on: string;
  student_id: string | null;
  staff_id: string | null;
  library_copies: { accession_no: string; library_books: { title: string } | null } | null;
  students: { admission_no: string; first_name: string; last_name: string | null } | null;
  staff: { employee_no: string; full_name: string } | null;
}

/**
 * Open loans past due, ordered soonest-overdue first. `fineSoFar` is
 * daysOverdue x settings.library.fine_per_day, in integer PAISE, and 0 for
 * staff (fine-exempt per rulings).
 *
 * UNIT WARNING: this `fineSoFar` (paise) is NOT the same unit as
 * `LibraryLoanRow.fine` from `libraryMyLoans` below (rupees/decimal). A UI
 * that renders both must convert one of them — do not share a formatter.
 */
export async function libraryOverdue(ctx: TenantContext, input: { limit?: number }): Promise<LibraryOverdueRow[]> {
  const supabase = await createClient();
  const limit = input.limit ?? 50;
  const today = todayInInstitutionTimezone(ctx);
  const finePerDay = librarySettings(ctx.institution.settings).fine_per_day;

  const { data, error } = await supabase
    .from("library_loans")
    .select(
      "id, issued_on, due_on, student_id, staff_id, library_copies(accession_no, library_books(title)), students(admission_no, first_name, last_name), staff(employee_no, full_name)",
    )
    .eq("institution_id", ctx.institution.id)
    .is("returned_on", null)
    .lt("due_on", today)
    .order("due_on", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as OverdueLoanRow[]).map((row) => {
    const daysOverdue = daysOverdueOf(row.due_on, today);
    const isStaff = row.staff_id !== null;
    const borrowerName = isStaff
      ? row.staff?.full_name ?? ""
      : `${row.students?.first_name ?? ""} ${row.students?.last_name ?? ""}`.trim();
    return {
      loanId: row.id,
      accessionNo: row.library_copies?.accession_no ?? "",
      title: row.library_copies?.library_books?.title ?? "",
      borrowerKind: isStaff ? "staff" : "student",
      borrowerId: isStaff ? row.staff_id! : row.student_id!,
      borrowerName,
      borrowerRef: isStaff ? row.staff?.employee_no ?? "" : row.students?.admission_no ?? "",
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      daysOverdue,
      fineSoFar: isStaff ? 0 : Math.round(daysOverdue * finePerDay * 100),
    };
  });
}

export interface LibraryLoanRow {
  loanId: string;
  studentId: string | null;
  title: string;
  accessionNo: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewCount: number;
  daysOverdue: number;
  /** RUPEES/decimal (matches `library_loans.fine_amount`), unlike `LibraryOverdueRow.fineSoFar` which is integer paise. See the unit warning on `libraryOverdue`. */
  fine: number;
}

interface MyLoanRow {
  id: string;
  student_id: string | null;
  staff_id: string | null;
  issued_on: string;
  due_on: string;
  returned_on: string | null;
  renew_count: number;
  fine_amount: number;
  fine_waived: boolean;
  library_copies: { accession_no: string; library_books: { title: string } | null } | null;
}

/**
 * The caller's own loans (open ones first, dueOn asc; then returned,
 * returnedOn desc), max 50. `studentId` given -> that student (RLS
 * decides); else a staff caller -> own staff loans; else -> the student
 * loans RLS already shows (guardian's children / student self).
 * `fine` is RUPEES/decimal — see `LibraryLoanRow.fine` unit warning.
 */
export async function libraryMyLoans(ctx: TenantContext, input: { studentId?: string }): Promise<LibraryLoanRow[]> {
  const supabase = await createClient();
  const today = todayInInstitutionTimezone(ctx);
  const finePerDay = librarySettings(ctx.institution.settings).fine_per_day;

  let query = supabase
    .from("library_loans")
    .select(
      "id, student_id, staff_id, issued_on, due_on, returned_on, renew_count, fine_amount, fine_waived, library_copies(accession_no, library_books(title))",
    )
    .eq("institution_id", ctx.institution.id);

  if (input.studentId) {
    query = query.eq("student_id", input.studentId);
  } else if (ctx.membership.staffId) {
    query = query.eq("staff_id", ctx.membership.staffId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as MyLoanRow[]).map((row) => {
    const daysOverdue = row.returned_on ? 0 : daysOverdueOf(row.due_on, today);
    const isStaff = row.staff_id !== null;
    const fine = row.returned_on ? (row.fine_waived ? 0 : row.fine_amount) : isStaff ? 0 : daysOverdue * finePerDay;
    return {
      loanId: row.id,
      studentId: row.student_id,
      title: row.library_copies?.library_books?.title ?? "",
      accessionNo: row.library_copies?.accession_no ?? "",
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      returnedOn: row.returned_on,
      renewCount: row.renew_count,
      daysOverdue,
      fine,
    };
  });

  rows.sort((a, b) => {
    if (!a.returnedOn && !b.returnedOn) return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;
    if (!a.returnedOn) return -1;
    if (!b.returnedOn) return 1;
    return a.returnedOn < b.returnedOn ? 1 : a.returnedOn > b.returnedOn ? -1 : 0;
  });

  return rows.slice(0, 50);
}
