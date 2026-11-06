// M21-T7 — fixture for forecast.run job tests
// (06-backend-packets/M21-tasks.md, Task 7 EXPORTS "seedForecastHistory").
// Deterministic relative to today in Asia/Kolkata (the institution's
// default timezone, 0094's series functions): `asOf` so a concurrent
// sweep from another test file's `runOnceCore` computes the same as_of
// and is an idempotent no-op instead of a race, not a fixed calendar date.
import postgres from "postgres";
import { attendanceWindow } from "@/modules/forecasts/series";
import {
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "./factories";
import type { TestInstitution } from "./roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function kolkataToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TermSpec {
  year: number; // academic year starts April `year`
  sequence: 1 | 2 | 3;
  name: string;
  startsOn: string;
  endsOn: string;
}

function termsOfYear(year: number): TermSpec[] {
  return [
    { year, sequence: 1, name: `Y${year} T1`, startsOn: `${year}-04-01`, endsOn: `${year}-07-31` },
    { year, sequence: 2, name: `Y${year} T2`, startsOn: `${year}-08-01`, endsOn: `${year}-11-30` },
    { year, sequence: 3, name: `Y${year} T3`, startsOn: `${year}-12-01`, endsOn: `${year + 1}-03-31` },
  ];
}

// Strong term-of-year pattern (t1 >> t2 > t3), same every year — makes
// seasonal_naive_v1 the clear winner over moving_average_v1 for fees:term
// (rulings' own expectation).
const TERM_AMOUNT: Record<1 | 2 | 3, number> = { 1: 6000, 2: 4000, 3: 2000 };

const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

async function setAttendanceStatusesIfAbsent(institutionId: string): Promise<void> {
  const [row] = await sql`
    select settings -> 'attendance' -> 'statuses' as statuses from public.institutions where id = ${institutionId}
  `;
  if (row?.statuses) return;
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function insertInvoice(
  institutionId: string,
  studentId: string,
  academicYearId: string,
  termId: string,
  total: number,
): Promise<string> {
  const invoiceNo = `INV-${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, concession_total, total, paid_total)
    values (${institutionId}, ${studentId}, ${academicYearId}, ${termId}, ${invoiceNo}, 'issued', ${total}, 0, ${total}, 0)
    returning id
  `;
  return row.id as string;
}

async function insertPayment(institutionId: string, invoiceId: string, amount: number, receivedAt: string): Promise<void> {
  await sql`
    insert into public.payments (institution_id, invoice_id, amount, mode, received_at, idempotency_key)
    values (${institutionId}, ${invoiceId}, ${amount}, 'cash', ${receivedAt}, ${crypto.randomUUID()})
  `;
}

async function insertSession(institutionId: string, classSectionId: string, date: string): Promise<string> {
  const [row] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date, status)
    values (${institutionId}, ${classSectionId}, ${date}, 'submitted')
    returning id
  `;
  return row.id as string;
}

async function insertRecord(institutionId: string, sessionId: string, studentId: string, status: string): Promise<void> {
  await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status)
    values (${institutionId}, ${sessionId}, ${studentId}, ${status})
  `;
}

/**
 * Seeds 3 academic years (Y-2, Y-1, Y, Y = the academic year containing
 * today), 9 terms with a strong seasonal fee pattern, and 10 weeks of
 * daily attendance for one section with 2 active students + a teacher
 * assignment, ending the week before today's ISO Monday. Returns `asOf`
 * (today, Asia/Kolkata) and `feeHorizons` (1-3: how many of year Y's
 * terms are not yet complete on `asOf`).
 */
export async function seedForecastHistory(inst: TestInstitution): Promise<{ asOf: string; feeHorizons: number }> {
  const asOf = kolkataToday();
  const [y, m] = asOf.split("-").map(Number);
  const currentYear = m >= 4 ? y : y - 1;
  const years = [currentYear - 2, currentYear - 1, currentYear];

  await setAttendanceStatusesIfAbsent(inst.institutionId);

  const academicYearIds = new Map<number, string>();
  for (const year of years) {
    const id = await createAcademicYear(inst.institutionId, {
      name: `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
      startsOn: `${year}-04-01`,
      endsOn: `${year + 1}-03-31`,
      isCurrent: year === currentYear,
    });
    academicYearIds.set(year, id);
  }

  const termIds = new Map<string, string>(); // `${year}:${sequence}` -> term id
  for (const year of years) {
    for (const t of termsOfYear(year)) {
      const id = await createTerm(inst.institutionId, academicYearIds.get(year)!, {
        name: t.name,
        sequence: t.sequence,
        startsOn: t.startsOn,
        endsOn: t.endsOn,
      });
      termIds.set(`${year}:${t.sequence}`, id);
    }
  }

  const allTerms = years
    .flatMap((year) => termsOfYear(year))
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  // Mirrors public.forecast_fee_series' own window math: window_end = next
  // term's starts_on, last term = ends_on + 1.
  const windowEnds = allTerms.map((t, i) => (i < allTerms.length - 1 ? allTerms[i + 1].startsOn : addDays(t.endsOn, 1)));

  const [student1, student2] = await Promise.all([insertStudent(inst.institutionId), insertStudent(inst.institutionId)]);

  let feeHorizons = 0;
  for (let i = 0; i < allTerms.length; i++) {
    const term = allTerms[i];
    const complete = windowEnds[i] <= asOf;
    if (term.year === currentYear && !complete) feeHorizons += 1;
    if (!complete) continue;

    const amount = TERM_AMOUNT[term.sequence];
    const receivedAt = `${addDays(term.startsOn, 5)}T00:00:00Z`;
    const termId = termIds.get(`${term.year}:${term.sequence}`)!;
    for (const studentId of [student1, student2]) {
      const invoiceId = await insertInvoice(inst.institutionId, studentId, academicYearIds.get(term.year)!, termId, amount);
      await insertPayment(inst.institutionId, invoiceId, amount, receivedAt);
    }
  }

  const grade = await createGrade(inst.institutionId, { code: "FC", displayName: "Forecast Test Grade", sortKey: 1, gradeGroup: "primary" });
  const section = await createClassSection(inst.institutionId, grade, academicYearIds.get(currentYear)!, { name: "FC" });
  await createEnrolment(inst.institutionId, student1, section, academicYearIds.get(currentYear)!, { startedOn: `${currentYear}-04-01` });
  await createEnrolment(inst.institutionId, student2, section, academicYearIds.get(currentYear)!, { startedOn: `${currentYear}-04-01` });

  const [teacherRow] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  const subjectId = await createSubject(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, section, subjectId, teacherRow.staff_id as string);

  // 10 weeks of Mon-Fri 'submitted' daily sessions, ending the week
  // before asOf's ISO Monday (so the series isn't "stale" per rulings,
  // but also doesn't include the in-progress current week).
  const { to: monday0 } = attendanceWindow(asOf);
  for (let w = 1; w <= 10; w++) {
    const weekStart = addDays(monday0, -7 * w);
    for (let d = 0; d < 5; d++) {
      const date = addDays(weekStart, d);
      const status = d < 4 ? "P" : "A"; // flat 80% rate every week, both students
      const sessionId = await insertSession(inst.institutionId, section, date);
      await insertRecord(inst.institutionId, sessionId, student1, status);
      await insertRecord(inst.institutionId, sessionId, student2, status);
    }
  }

  return { asOf, feeHorizons };
}

export async function closeForecastFixturesHelper(): Promise<void> {
  await sql.end();
}
