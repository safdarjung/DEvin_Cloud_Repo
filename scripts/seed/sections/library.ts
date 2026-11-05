import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// X03-T8 (X03-tasks.md Task 8). Catalogue ids are deterministic (uuidV5-style,
// keyed off the natural key: author+title for books, accession number for
// copies) so `tests/db/seed-library.test.ts`'s reseed check is bit-identical.
// Loan dates are relative to real "today" in Asia/Kolkata (the same rule
// `app.issue_library_loan`/`app.return_library_loan` use) so Ananya's loan
// stays overdue and Aarav's stays open no matter when `pnpm demo:reset`
// runs — `library_loans.id` keeps its `gen_random_uuid()` default (same as
// finance.ts's invoices / exams.ts's results), since only the catalogue's
// ids are part of the determinism contract.
//
// No RPC calls: `library_loans` has no INSERT policy for `authenticated`
// (0086 "lesson 3" — only the three RPCs write it), but this seed runs with
// the service-role key, which bypasses RLS entirely, so bulk `insertBatch`
// is used the same way as every other seed section.

function todayInKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Indian school library mix (rulings): Premchand (Devanagari — he wrote in
 * Hindi; ~10% of the 120 titles), Ruskin Bond, R. K. Narayan (incl. "Malgudi
 * Days"), Sudha Murty, A. P. J. Abdul Kalam (incl. "Wings of Fire"),
 * Panchatantra, Amar Chitra Katha, NCERT reference, GK. */
const BOOK_DEFS: { title: string; author: string }[] = [
  // Premchand — 10 (Devanagari)
  { title: "गोदान", author: "Premchand" },
  { title: "निर्मला", author: "Premchand" },
  { title: "गबन", author: "Premchand" },
  { title: "ईदगाह", author: "Premchand" },
  { title: "कफ़न", author: "Premchand" },
  { title: "पूस की रात", author: "Premchand" },
  { title: "बड़े भाई साहब", author: "Premchand" },
  { title: "रंगभूमि", author: "Premchand" },
  { title: "कर्मभूमि", author: "Premchand" },
  { title: "मानसरोवर", author: "Premchand" },
  // Ruskin Bond — 16
  { title: "The Room on the Roof", author: "Ruskin Bond" },
  { title: "Rusty, the Boy from the Hills", author: "Ruskin Bond" },
  { title: "The Blue Umbrella", author: "Ruskin Bond" },
  { title: "A Flight of Pigeons", author: "Ruskin Bond" },
  { title: "Angry River", author: "Ruskin Bond" },
  { title: "Vagrants in the Valley", author: "Ruskin Bond" },
  { title: "Delhi Is Not Far", author: "Ruskin Bond" },
  { title: "The Night Train at Deoli", author: "Ruskin Bond" },
  { title: "Our Trees Still Grow in Dehra", author: "Ruskin Bond" },
  { title: "Hanuman to the Rescue", author: "Ruskin Bond" },
  { title: "Ghost Stories from the Raj", author: "Ruskin Bond" },
  { title: "A Handful of Nuts", author: "Ruskin Bond" },
  { title: "Strange Men, Strange Places", author: "Ruskin Bond" },
  { title: "Time Stops at Shamli", author: "Ruskin Bond" },
  { title: "The Cherry Tree", author: "Ruskin Bond" },
  { title: "Tales of Fosterganj", author: "Ruskin Bond" },
  // R. K. Narayan — 11 (incl. the named "Malgudi Days")
  { title: "Malgudi Days", author: "R. K. Narayan" },
  { title: "Swami and Friends", author: "R. K. Narayan" },
  { title: "The Guide", author: "R. K. Narayan" },
  { title: "The English Teacher", author: "R. K. Narayan" },
  { title: "Waiting for the Mahatma", author: "R. K. Narayan" },
  { title: "The Financial Expert", author: "R. K. Narayan" },
  { title: "The Vendor of Sweets", author: "R. K. Narayan" },
  { title: "Mr. Sampath", author: "R. K. Narayan" },
  { title: "The Dark Room", author: "R. K. Narayan" },
  { title: "The World of Nagaraj", author: "R. K. Narayan" },
  { title: "Grandmother's Tale", author: "R. K. Narayan" },
  // Sudha Murty — 14
  { title: "Wise and Otherwise", author: "Sudha Murty" },
  { title: "How I Taught My Grandmother to Read", author: "Sudha Murty" },
  { title: "The Magic of the Lost Temple", author: "Sudha Murty" },
  { title: "Grandma's Bag of Stories", author: "Sudha Murty" },
  { title: "Gently Falls the Bakula", author: "Sudha Murty" },
  { title: "Here, There and Everywhere", author: "Sudha Murty" },
  { title: "The Serpent's Revenge", author: "Sudha Murty" },
  { title: "The Man from the Egg", author: "Sudha Murty" },
  { title: "The Day I Stopped Drinking Milk", author: "Sudha Murty" },
  { title: "Three Thousand Stitches", author: "Sudha Murty" },
  { title: "The Upside-Down King", author: "Sudha Murty" },
  { title: "The Bird with Golden Wings", author: "Sudha Murty" },
  { title: "Dollar Bahu", author: "Sudha Murty" },
  { title: "House of Cards", author: "Sudha Murty" },
  // A. P. J. Abdul Kalam — 10 (incl. the named "Wings of Fire")
  { title: "Wings of Fire", author: "A. P. J. Abdul Kalam" },
  { title: "Ignited Minds", author: "A. P. J. Abdul Kalam" },
  { title: "India 2020", author: "A. P. J. Abdul Kalam" },
  { title: "The Luminous Sparks", author: "A. P. J. Abdul Kalam" },
  { title: "Guiding Souls", author: "A. P. J. Abdul Kalam" },
  { title: "My Journey", author: "A. P. J. Abdul Kalam" },
  { title: "Transcendence", author: "A. P. J. Abdul Kalam" },
  { title: "Target 3 Billion", author: "A. P. J. Abdul Kalam" },
  { title: "Turning Points", author: "A. P. J. Abdul Kalam" },
  { title: "You Are Born to Blossom", author: "A. P. J. Abdul Kalam" },
  // Panchatantra — 12 (2 Devanagari)
  { title: "The Lion and the Mouse", author: "Panchatantra" },
  { title: "The Monkey and the Crocodile", author: "Panchatantra" },
  { title: "The Thirsty Crow", author: "Panchatantra" },
  { title: "The Tortoise and the Geese", author: "Panchatantra" },
  { title: "The Clever Fox", author: "Panchatantra" },
  { title: "The Foolish Lion", author: "Panchatantra" },
  { title: "The Blue Jackal", author: "Panchatantra" },
  { title: "The Mongoose and the Farmer's Wife", author: "Panchatantra" },
  { title: "The Golden Swan", author: "Panchatantra" },
  { title: "The Camel and the Jackal", author: "Panchatantra" },
  { title: "पंचतंत्र की कहानियाँ", author: "Panchatantra" },
  { title: "हितोपदेश की कथाएँ", author: "Panchatantra" },
  // Amar Chitra Katha — 16
  { title: "Akbar", author: "Amar Chitra Katha" },
  { title: "Shivaji", author: "Amar Chitra Katha" },
  { title: "Birbal", author: "Amar Chitra Katha" },
  { title: "Tenali Rama", author: "Amar Chitra Katha" },
  { title: "Hanuman", author: "Amar Chitra Katha" },
  { title: "Krishna", author: "Amar Chitra Katha" },
  { title: "Rana Pratap", author: "Amar Chitra Katha" },
  { title: "Ashoka", author: "Amar Chitra Katha" },
  { title: "Chanakya", author: "Amar Chitra Katha" },
  { title: "Hitopadesha", author: "Amar Chitra Katha" },
  { title: "Jataka Tales", author: "Amar Chitra Katha" },
  { title: "Rani Lakshmibai", author: "Amar Chitra Katha" },
  { title: "Guru Nanak", author: "Amar Chitra Katha" },
  { title: "Mahatma Gandhi", author: "Amar Chitra Katha" },
  { title: "Buddha", author: "Amar Chitra Katha" },
  { title: "Vikram and Betaal", author: "Amar Chitra Katha" },
  // NCERT reference — 19
  { title: "Science Class 6", author: "NCERT" },
  { title: "Science Class 7", author: "NCERT" },
  { title: "Science Class 8", author: "NCERT" },
  { title: "Science Class 9", author: "NCERT" },
  { title: "Science Class 10", author: "NCERT" },
  { title: "Mathematics Class 6", author: "NCERT" },
  { title: "Mathematics Class 7", author: "NCERT" },
  { title: "Mathematics Class 8", author: "NCERT" },
  { title: "Mathematics Class 9", author: "NCERT" },
  { title: "Mathematics Class 10", author: "NCERT" },
  { title: "Social Science Class 6", author: "NCERT" },
  { title: "Social Science Class 7", author: "NCERT" },
  { title: "Social Science Class 8", author: "NCERT" },
  { title: "English Class 6", author: "NCERT" },
  { title: "English Class 7", author: "NCERT" },
  { title: "English Class 8", author: "NCERT" },
  { title: "Hindi Class 6", author: "NCERT" },
  { title: "Hindi Class 7", author: "NCERT" },
  { title: "Hindi Class 8", author: "NCERT" },
  // GK — 12
  { title: "India General Knowledge 2024", author: "General Knowledge" },
  { title: "World General Knowledge", author: "General Knowledge" },
  { title: "Science GK Quiz Book", author: "General Knowledge" },
  { title: "Current Affairs Digest", author: "General Knowledge" },
  { title: "Indian Constitution Basics", author: "General Knowledge" },
  { title: "Geography GK", author: "General Knowledge" },
  { title: "Sports GK", author: "General Knowledge" },
  { title: "History GK India", author: "General Knowledge" },
  { title: "GK for Class 6-8", author: "General Knowledge" },
  { title: "GK for Class 9-10", author: "General Knowledge" },
  { title: "GK for Class 11-12", author: "General Knowledge" },
  { title: "Environment and Ecology GK", author: "General Knowledge" },
];

// 3 copies withdrawn, all inside the Premchand run (accession #1, #5, #9) —
// nowhere near the Malgudi Days / Wings of Fire copies used below.
const WITHDRAWN_ACCESSION_NUMBERS = new Set([1, 5, 9]);

/** Evenly spread `n` picks across `pool`, deterministic and distinct (for n*stride < pool.length, true for every call below). */
function pickStride<T>(pool: T[], n: number, offset: number): T[] {
  if (pool.length === 0 || n === 0) return [];
  const stride = Math.max(1, Math.floor(pool.length / n));
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool[(offset + i * stride) % pool.length]!);
  return out;
}

export async function run(ctx: SeedContext): Promise<void> {
  // ---- books + copies (deterministic ids; LIB-0001... in insertion order) ----
  const bookRows: Record<string, unknown>[] = [];
  const copyRows: Record<string, unknown>[] = [];
  const copiesByBookKey = new Map<string, { id: string; status: string }[]>();

  let accessionCounter = 0;
  BOOK_DEFS.forEach((def, i) => {
    const key = `${def.author}::${def.title}`;
    const bookId = uuidV5("library", `book:${key}`);
    const isbn = i % 2 === 0 ? `978${String(i).padStart(10, "0")}` : null;
    bookRows.push({ id: bookId, institution_id: ctx.institutionId, title: def.title, author: def.author, isbn });

    const copyCount = [1, 2, 3][i % 3]!;
    const copies: { id: string; status: string }[] = [];
    for (let c = 0; c < copyCount; c++) {
      accessionCounter += 1;
      const accessionNo = `LIB-${String(accessionCounter).padStart(4, "0")}`;
      const copyId = uuidV5("library", `copy:${accessionNo}`);
      const status = WITHDRAWN_ACCESSION_NUMBERS.has(accessionCounter) ? "withdrawn" : "active";
      copies.push({ id: copyId, status });
      copyRows.push({ id: copyId, institution_id: ctx.institutionId, book_id: bookId, accession_no: accessionNo, status });
    }
    copiesByBookKey.set(key, copies);
  });

  await insertBatch(ctx.admin, "library_books", bookRows);
  await insertBatch(ctx.admin, "library_copies", copyRows);

  // ---- borrowers: Aarav (VI-A), Ananya (X-A), teacher.x-a (05 §8.1 fixture) ----
  const allStudents = Object.entries(ctx.studentsBySection).flatMap(([sectionKey, students]) =>
    students.map((s) => ({ id: s.id, firstName: s.firstName, sectionKey })),
  );
  const aarav = allStudents.find((s) => s.sectionKey === "VI-A" && s.firstName === "Aarav");
  const ananya = allStudents.find((s) => s.sectionKey === "X-A" && s.firstName === "Ananya");
  if (!aarav || !ananya) throw new Error("library: Aarav (VI-A) / Ananya (X-A) not found in ctx.studentsBySection");
  const teacherXAStaffId = ctx.linkIdByLogin["teacher.x-a"];
  if (!teacherXAStaffId) throw new Error("library: teacher.x-a not found in ctx.linkIdByLogin");
  const issuedByUserId = ctx.userIdByLogin["principal"];
  if (!issuedByUserId) throw new Error("library: principal login not found in ctx.userIdByLogin");

  const malgudiCopy = copiesByBookKey.get("R. K. Narayan::Malgudi Days")!.find((c) => c.status === "active")!;
  const wingsCopy = copiesByBookKey.get("A. P. J. Abdul Kalam::Wings of Fire")!.find((c) => c.status === "active")!;

  const activeCopies = copyRows.filter((c) => c.status === "active");
  const reservedCopyIds = new Set([malgudiCopy.id, wingsCopy.id]);
  const remainingActiveCopies = activeCopies.filter((c) => !reservedCopyIds.has(c.id as string));
  // 42 distinct copies for the other open loans (stride touches indices
  // 0..205 of ~235) + the last copy for teacher.x-a (outside that range).
  const otherOpenCopies = pickStride(remainingActiveCopies, 42, 0);
  const teacherXACopy = remainingActiveCopies[remainingActiveCopies.length - 1]!;

  const otherStudentPool = allStudents.filter((s) => s.id !== aarav.id && s.id !== ananya.id);
  const otherStaffPool = ctx.teacherStaffIds.filter((id) => id !== teacherXAStaffId);
  const otherOpenStudents = pickStride(otherStudentPool, 33, 0);
  const otherOpenStaff = pickStride(otherStaffPool, 9, 0);
  const returnedStudents = pickStride(otherStudentPool, 80, 1);
  const returnedCopies = pickStride(activeCopies, 80, 2);

  const today = todayInKolkata();
  const LOAN_DAYS = 14; // default loan_days (no `library` settings block seeded — defaults apply)
  const loanRows: Record<string, unknown>[] = [];

  function openLoanRow(copyId: string, borrower: { studentId?: string; staffId?: string }, dueOffsetDays: number) {
    const dueOn = addDays(today, dueOffsetDays);
    loanRows.push({
      institution_id: ctx.institutionId,
      copy_id: copyId,
      student_id: borrower.studentId ?? null,
      staff_id: borrower.staffId ?? null,
      issued_on: addDays(dueOn, -LOAN_DAYS),
      due_on: dueOn,
      issued_by: issuedByUserId,
    });
  }

  function returnedLoanRow(copyId: string, borrower: { studentId?: string; staffId?: string }, pastIssuedOffsetDays: number, returnBeforeDue: number) {
    const issuedOn = addDays(today, -pastIssuedOffsetDays);
    const dueOn = addDays(issuedOn, LOAN_DAYS);
    loanRows.push({
      institution_id: ctx.institutionId,
      copy_id: copyId,
      student_id: borrower.studentId ?? null,
      staff_id: borrower.staffId ?? null,
      issued_on: issuedOn,
      due_on: dueOn,
      returned_on: addDays(dueOn, -returnBeforeDue), // on or before due -> fine 0
      issued_by: issuedByUserId,
      returned_by: issuedByUserId,
    });
  }

  // Named (05 §8.1): Aarav — due today+5, not overdue. Ananya — 6 days
  // overdue (returning it live charges her current-term invoice). teacher.x-a — one open loan.
  openLoanRow(malgudiCopy.id as string, { studentId: aarav.id }, 5);
  openLoanRow(wingsCopy.id as string, { studentId: ananya.id }, -6);
  openLoanRow(teacherXACopy.id as string, { staffId: teacherXAStaffId }, 7);

  // Other open: 35 students / 10 staff total incl. the 3 named above; 10 of
  // the 45 open loans overdue 1-20 days (incl. Ananya) — 6 more students + 3
  // more staff here, the rest due in the future (within default limits).
  otherOpenStudents.forEach((s, i) => {
    const copyId = otherOpenCopies[i]!.id as string;
    if (i < 6) openLoanRow(copyId, { studentId: s.id }, -(1 + ((i * 7) % 20)));
    else openLoanRow(copyId, { studentId: s.id }, 1 + ((i * 3) % 13));
  });
  otherOpenStaff.forEach((staffId, i) => {
    const copyId = otherOpenCopies[33 + i]!.id as string;
    if (i < 3) openLoanRow(copyId, { staffId }, -(1 + ((i * 5) % 20)));
    else openLoanRow(copyId, { staffId }, 1 + ((i * 2) % 13));
  });

  // 80 returned on or before due, fine 0 — no invoice/ledger writes.
  returnedStudents.forEach((s, i) => {
    returnedLoanRow(returnedCopies[i]!.id as string, { studentId: s.id }, 30 + i * 2, i % 6);
  });

  await insertBatch(ctx.admin, "library_loans", loanRows);
}
