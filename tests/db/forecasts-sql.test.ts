// M21-T3 — migration 0094 part 2: public.forecast_fee_series,
// public.forecast_attendance_series, public.enqueue_due_forecasts
// (06-backend-packets/M21-tasks.md rulings "Series sources", "Scheduling").
// Fixtures inserted directly via the raw `sql` connection (bypassing
// RLS/PostgREST — session_user = 'postgres'), same pattern as
// tests/db/fee-reminders.test.ts and tests/db/report-sweep-rpc.test.ts.
// Permission checks go through `admin.rpc(...)` / `clientAs(role).rpc(...)`
// (real PostgREST grants) instead.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
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
  overrides: Partial<{ status: string; total: number }> = {},
): Promise<string> {
  const status = overrides.status ?? "issued";
  const total = overrides.total ?? 1000;
  const invoiceNo = `INV-${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, concession_total, total, paid_total)
    values (${institutionId}, ${studentId}, ${academicYearId}, ${termId}, ${invoiceNo}, ${status}, ${total}, 0, ${total}, 0)
    returning id
  `;
  return row.id as string;
}

async function insertPayment(institutionId: string, invoiceId: string, amount: number, receivedAt: string): Promise<string> {
  const [row] = await sql`
    insert into public.payments (institution_id, invoice_id, amount, mode, received_at, idempotency_key)
    values (${institutionId}, ${invoiceId}, ${amount}, 'cash', ${receivedAt}, ${crypto.randomUUID()})
    returning id
  `;
  return row.id as string;
}

async function reversePayment(institutionId: string, paymentId: string, invoiceId: string): Promise<void> {
  await sql`
    insert into public.payment_reversals (institution_id, payment_id, invoice_id, kind, amount, reason, snapshot, idempotency_key)
    values (${institutionId}, ${paymentId}, ${invoiceId}, 'void', 1, 'test reversal probe', '{}'::jsonb, ${crypto.randomUUID()})
  `;
}

const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
  { code: "H", label: "Holiday", counts_present: 0, in_denominator: false },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertPeriod(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, 1, 'P1', '08:00', '08:40')
    returning id
  `;
  return row.id as string;
}

async function insertPeriodSession(institutionId: string, classSectionId: string, date: string, periodId: string): Promise<string> {
  const [row] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date, status, period_id)
    values (${institutionId}, ${classSectionId}, ${date}, 'submitted', ${periodId})
    returning id
  `;
  return row.id as string;
}

async function jobsFor(institutionId: string) {
  return sql`select * from public.jobs where type = 'forecast.run' and institution_id = ${institutionId}::uuid`;
}

describe("public.forecast_fee_series (0094)", () => {
  it("contiguous windows; gap payment lands in the earlier term; reversed/cross-institution payments and cancelled invoices excluded; exact paise", async () => {
    const inst = await createTestInstitution("fee-series");
    createdInstitutions.push(inst);
    const other = await createTestInstitution("fee-series-other");
    createdInstitutions.push(other);

    const year = await createAcademicYear(inst.institutionId);
    const [row] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
    const studentId = row.student_id as string;

    // Deliberate gaps between terms (ends_on of one < starts_on of the
    // next) so the window-contiguity rule is actually exercised, not
    // accidentally satisfied by back-to-back dates.
    const t1 = await createTerm(inst.institutionId, year, { name: "T1", sequence: 1, startsOn: "2026-04-01", endsOn: "2026-07-15" });
    await createTerm(inst.institutionId, year, { name: "T2", sequence: 2, startsOn: "2026-08-01", endsOn: "2026-11-15" });
    const t3 = await createTerm(inst.institutionId, year, { name: "T3", sequence: 3, startsOn: "2026-12-01", endsOn: "2027-03-31" });

    const inv1 = await insertInvoice(inst.institutionId, studentId, year, t1, { total: 1234.56 });
    await insertInvoice(inst.institutionId, studentId, year, t1, { status: "cancelled", total: 500 });
    const inv3 = await insertInvoice(inst.institutionId, studentId, year, t3, { total: 100 });

    // In the gap after T1 ends (07-15) and before T2 starts (08-01) — must
    // still land in T1 (window_end = next term's starts_on, not ends_on+1).
    await insertPayment(inst.institutionId, inv1, 1234.56, "2026-07-20T00:00:00Z");
    // Reversed — excluded from T1's collected_paise.
    const reversed = await insertPayment(inst.institutionId, inv1, 50, "2026-05-01T00:00:00Z");
    await reversePayment(inst.institutionId, reversed, inv1);
    // Last calendar day of the last term's window (ends_on + 1 is exclusive).
    await insertPayment(inst.institutionId, inv3, 100, "2027-03-31T00:00:00Z");

    const otherYear = await createAcademicYear(other.institutionId);
    const otherTerm = await createTerm(other.institutionId, otherYear, { startsOn: "2026-04-01", endsOn: "2026-07-15" });
    const [otherRow] = await sql`select student_id from public.memberships where institution_id = ${other.institutionId} and role = 'student'`;
    const otherInv = await insertInvoice(other.institutionId, otherRow.student_id as string, otherYear, otherTerm, { total: 999 });
    await insertPayment(other.institutionId, otherInv, 999, "2026-05-01T00:00:00Z");

    const rows = await sql<{ sequence: number; starts_on: string; window_end: string; collected_paise: string; billed_paise: string }[]>`
      select sequence, starts_on::text, window_end::text, collected_paise, billed_paise
      from public.forecast_fee_series(${inst.institutionId}::uuid)
      order by sequence
    `;
    expect(rows).toHaveLength(3);

    expect(rows[0].window_end).toBe(rows[1].starts_on);
    expect(rows[1].window_end).toBe(rows[2].starts_on);
    expect(rows[2].window_end).toBe("2027-04-01"); // ends_on (2027-03-31) + 1

    expect(Number(rows[0].collected_paise)).toBe(123456); // gap payment only; reversed payment excluded
    expect(Number(rows[0].billed_paise)).toBe(123456); // cancelled invoice excluded
    expect(Number(rows[2].collected_paise)).toBe(10000); // last-day-of-window payment included
    expect(Number(rows[2].billed_paise)).toBe(10000);
  });

  it("authenticated cannot execute it (42501); service_role can", async () => {
    const inst = await createTestInstitution("fee-series-perm");
    createdInstitutions.push(inst);

    const authed = await inst.clientAs("admin").rpc("forecast_fee_series", { p_institution_id: inst.institutionId });
    expect(authed.error?.code).toBe("42501");

    const asService = await admin.rpc("forecast_fee_series", { p_institution_id: inst.institutionId });
    expect(asService.error).toBeNull();
  });
});

describe("public.forecast_attendance_series (0094)", () => {
  it("weighs counts_present/in_denominator from settings, ignores open and period-based sessions, sums sections into the school-wide row", async () => {
    const inst = await createTestInstitution("attendance-series");
    createdInstitutions.push(inst);
    await setAttendanceStatuses(inst.institutionId);

    const year = await createAcademicYear(inst.institutionId);
    const grade = await createGrade(inst.institutionId);
    const sectionA = await createClassSection(inst.institutionId, grade, year, { name: "A" });
    const sectionB = await createClassSection(inst.institutionId, grade, year, { name: "B" });
    const students = await Promise.all(Array.from({ length: 6 }, () => insertStudent(inst.institutionId)));

    // Same ISO week (Wed 10-14 .. Fri 10-16).
    const sessionA = await createAttendanceSession(inst.institutionId, sectionA, { date: "2026-10-14", status: "submitted" });
    await createAttendanceRecord(inst.institutionId, sessionA, students[0], { status: "P" });
    await createAttendanceRecord(inst.institutionId, sessionA, students[1], { status: "P" });
    await createAttendanceRecord(inst.institutionId, sessionA, students[2], { status: "A" });
    await createAttendanceRecord(inst.institutionId, sessionA, students[3], { status: "H" }); // not in_denominator

    const sessionB = await createAttendanceSession(inst.institutionId, sectionB, { date: "2026-10-15", status: "submitted" });
    await createAttendanceRecord(inst.institutionId, sessionB, students[4], { status: "P" });
    await createAttendanceRecord(inst.institutionId, sessionB, students[5], { status: "A" });

    // Excluded: session not submitted yet.
    const openSession = await createAttendanceSession(inst.institutionId, sectionA, { date: "2026-10-16", status: "open" });
    await createAttendanceRecord(inst.institutionId, openSession, students[0], { status: "P" });

    // Excluded: period-based (non-daily) session.
    const period = await insertPeriod(inst.institutionId);
    const periodSession = await insertPeriodSession(inst.institutionId, sectionA, "2026-10-13", period);
    await createAttendanceRecord(inst.institutionId, periodSession, students[0], { status: "P" });

    const rows = await sql<{ class_section_id: string | null; points: { week_start: string; present: number; denominator: number }[] }[]>`
      select class_section_id, points
      from public.forecast_attendance_series(${inst.institutionId}::uuid, '2026-10-01'::date, '2026-10-31'::date)
    `;
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.class_section_id, r.points]));

    const a = byId.get(sectionA)!;
    expect(a).toHaveLength(1);
    expect(Number(a[0].present)).toBe(2);
    expect(Number(a[0].denominator)).toBe(3); // H excluded

    const b = byId.get(sectionB)!;
    expect(b).toHaveLength(1);
    expect(Number(b[0].present)).toBe(1);
    expect(Number(b[0].denominator)).toBe(2);

    const school = byId.get(null)!;
    expect(school).toHaveLength(1);
    expect(Number(school[0].present)).toBe(3); // sum of section rows
    expect(Number(school[0].denominator)).toBe(5);
  });

  it("rejects a window over 400 days", async () => {
    const inst = await createTestInstitution("attendance-window");
    createdInstitutions.push(inst);

    await expect(
      sql`select * from public.forecast_attendance_series(${inst.institutionId}::uuid, '2025-01-01'::date, '2026-03-01'::date)`,
    ).rejects.toThrow(/code:validation_failed/);
  });

  it("authenticated cannot execute it (42501); service_role can", async () => {
    const inst = await createTestInstitution("attendance-series-perm");
    createdInstitutions.push(inst);

    const authed = await inst.clientAs("admin").rpc("forecast_attendance_series", {
      p_institution_id: inst.institutionId,
      p_from: "2026-10-01",
      p_to: "2026-10-31",
    });
    expect(authed.error?.code).toBe("42501");

    const asService = await admin.rpc("forecast_attendance_series", {
      p_institution_id: inst.institutionId,
      p_from: "2026-10-01",
      p_to: "2026-10-31",
    });
    expect(asService.error).toBeNull();
  });
});

describe("public.enqueue_due_forecasts (0094 sweep)", () => {
  // 2026-11-01T20:00Z is 2026-11-02 01:30 in Asia/Kolkata (the ruling's own example).
  const P_NOW = "2026-11-01T20:00:00Z";

  it("one institution with something to forecast gets exactly one job, keyed by local date; a repeat sweep adds nothing", async () => {
    const inst = await createTestInstitution("sweep-forecasts");
    createdInstitutions.push(inst);
    const year = await createAcademicYear(inst.institutionId);
    const grade = await createGrade(inst.institutionId);
    const section = await createClassSection(inst.institutionId, grade, year);
    await createAttendanceSession(inst.institutionId, section, { date: "2026-10-25", status: "submitted" });

    const first = await admin.rpc("enqueue_due_forecasts", { p_now: P_NOW });
    expect(first.error).toBeNull();

    const jobs = await jobsFor(inst.institutionId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.as_of).toBe("2026-11-02");
    expect(jobs[0].idempotency_key).toBe(`forecast.run:${inst.institutionId}:20261102`);

    const second = await admin.rpc("enqueue_due_forecasts", { p_now: P_NOW });
    expect(second.error).toBeNull();
    expect(await jobsFor(inst.institutionId)).toHaveLength(1);
  });

  it("module off -> no job", async () => {
    const inst = await createTestInstitution("sweep-off");
    createdInstitutions.push(inst);
    const year = await createAcademicYear(inst.institutionId);
    const grade = await createGrade(inst.institutionId);
    const section = await createClassSection(inst.institutionId, grade, year);
    await createAttendanceSession(inst.institutionId, section, { date: "2026-10-25", status: "submitted" });
    await setModule(inst.institutionId, "forecasts", false);

    await admin.rpc("enqueue_due_forecasts", { p_now: P_NOW });
    expect(await jobsFor(inst.institutionId)).toHaveLength(0);
  });

  it("module on but nothing to forecast in the last 400 days -> no job", async () => {
    const inst = await createTestInstitution("sweep-stale");
    createdInstitutions.push(inst);

    await admin.rpc("enqueue_due_forecasts", { p_now: P_NOW });
    expect(await jobsFor(inst.institutionId)).toHaveLength(0);
  });

  it("authenticated cannot execute it (42501); service_role can", async () => {
    const inst = await createTestInstitution("sweep-perm");
    createdInstitutions.push(inst);

    const authed = await inst.clientAs("admin").rpc("enqueue_due_forecasts");
    expect(authed.error?.code).toBe("42501");

    const asService = await admin.rpc("enqueue_due_forecasts");
    expect(asService.error).toBeNull();
  });
});
