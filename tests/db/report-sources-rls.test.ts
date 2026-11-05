// M15-T4 — migration 0077 part 2: report source functions
// (report_attendance_daily, report_fee_defaulters) + documents RLS for the
// `report` entity type. Same fixture shape as tests/db/attendance-actions.test.ts
// (ATTENDANCE_STATUSES) and tests/db/documents-rls.test.ts (storage pattern).
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// 05 §4.1 shape (mirrors attendance-actions.test.ts's ATTENDANCE_STATUSES).
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
  { code: "L", label: "Late", counts_present: 1, in_denominator: true },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertStudent(
  institutionId: string,
  admissionNo: string,
  overrides: Partial<{ firstName: string; lastName: string | null }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (
      ${institutionId}, ${admissionNo}, ${overrides.firstName ?? "Test"}, ${overrides.lastName ?? null},
      '2015-01-01', 'other'
    )
    returning id
  `;
  return row.id as string;
}

async function insertInvoice(opts: {
  institutionId: string;
  studentId: string;
  academicYearId: string;
  termId: string;
  invoiceNo: string;
  status: string;
  total: number;
  paidTotal: number;
  dueOn: string | null;
}): Promise<void> {
  await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, total, paid_total, due_on)
    values (
      ${opts.institutionId}, ${opts.studentId}, ${opts.academicYearId}, ${opts.termId}, ${opts.invoiceNo},
      ${opts.status}, ${opts.total}, ${opts.paidTotal}, ${opts.dueOn}
    )
  `;
}

async function createSchedule(inst: TestInstitution, source: string, recipientRoles: string[]): Promise<string> {
  const { data, error } = await admin
    .from("scheduled_reports")
    .insert({
      institution_id: inst.institutionId,
      name: `Schedule ${crypto.randomUUID().slice(0, 8)}`,
      source,
      cron: "0 20 * * *",
      recipient_roles: recipientRoles,
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create schedule fixture");
  return data.id as string;
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("public.report_attendance_daily (0077)", () => {
  it(
    "one row per section: submitted weighted %, unmarked not_marked, period session ignored, " +
      "day_offset reads yesterday, institution isolation both ways",
    async () => {
      await withTwoInstitutions(async (instA, instB) => {
        await setAttendanceStatuses(instA.institutionId);

        const today = todayInTimezone("Asia/Kolkata");
        const yesterday = addDaysToIso(today, -1);

        const yearA = await createAcademicYear(instA.institutionId);
        const gradeMarked = await createGrade(instA.institutionId, { code: "M", displayName: "Grade M", sortKey: 1 });
        const gradeUnmarked = await createGrade(instA.institutionId, { code: "U", displayName: "Grade U", sortKey: 2 });
        const gradePeriod = await createGrade(instA.institutionId, { code: "PD", displayName: "Grade P", sortKey: 3 });

        const sectionMarked = await createClassSection(instA.institutionId, gradeMarked, yearA, { name: "Marked" });
        const sectionUnmarked = await createClassSection(instA.institutionId, gradeUnmarked, yearA, { name: "Unmarked" });
        const sectionPeriod = await createClassSection(instA.institutionId, gradePeriod, yearA, { name: "Period" });

        const s1 = await insertStudent(instA.institutionId, "ADM-RPT-1");
        const s2 = await insertStudent(instA.institutionId, "ADM-RPT-2");
        const s3 = await insertStudent(instA.institutionId, "ADM-RPT-3");
        await createEnrolment(instA.institutionId, s1, sectionMarked, yearA);
        await createEnrolment(instA.institutionId, s2, sectionMarked, yearA);
        await createEnrolment(instA.institutionId, s3, sectionMarked, yearA);

        const sU1 = await insertStudent(instA.institutionId, "ADM-RPT-U1");
        await createEnrolment(instA.institutionId, sU1, sectionUnmarked, yearA);

        const sessionToday = await createAttendanceSession(instA.institutionId, sectionMarked, { date: today, status: "submitted" });
        await createAttendanceRecord(instA.institutionId, sessionToday, s1, { status: "P" });
        await createAttendanceRecord(instA.institutionId, sessionToday, s2, { status: "A" });
        await createAttendanceRecord(instA.institutionId, sessionToday, s3, { status: "L" });

        const sessionYesterday = await createAttendanceSession(instA.institutionId, sectionMarked, { date: yesterday, status: "submitted" });
        await createAttendanceRecord(instA.institutionId, sessionYesterday, s1, { status: "P" });

        // A period session on `today` for sectionPeriod must be ignored by the daily reader.
        const [period] = await sql`
          insert into public.periods (institution_id, seq, name, starts_at, ends_at)
          values (${instA.institutionId}, 1, 'P1', '09:00', '09:40')
          returning id
        `;
        await sql`
          insert into public.attendance_sessions (institution_id, class_section_id, date, status, period_id)
          values (${instA.institutionId}, ${sectionPeriod}, ${today}, 'submitted', ${period.id})
        `;

        // Institution B gets its own section (same-day coverage) to prove the
        // p_institution_id filter, not caller identity, scopes the rows.
        const yearB = await createAcademicYear(instB.institutionId);
        const gradeB = await createGrade(instB.institutionId, { code: "B", displayName: "Grade B", sortKey: 1 });
        await createClassSection(instB.institutionId, gradeB, yearB, { name: "BSection" });

        const nowIso = new Date().toISOString();

        const { data, error } = await instA.clientAs("principal").rpc("report_attendance_daily", {
          p_institution_id: instA.institutionId,
          p_as_of: nowIso,
          p_day_offset: 0,
        });
        expect(error).toBeNull();
        expect(data).toHaveLength(3);

        const marked = data!.find((r: Record<string, unknown>) => r.section === "Marked")!;
        expect(marked.session_status).toBe("submitted");
        expect(marked.enrolled).toBe(3);
        expect(marked.marked).toBe(3);
        expect(marked.denominator).toBe(3);
        expect(Number(marked.present_weighted)).toBe(2);
        expect(Number(marked.percentage)).toBeCloseTo(66.67, 2);

        const unmarked = data!.find((r: Record<string, unknown>) => r.section === "Unmarked")!;
        expect(unmarked.session_status).toBe("not_marked");
        expect(unmarked.enrolled).toBe(1);
        expect(unmarked.marked).toBe(0);
        expect(unmarked.denominator).toBe(0);
        expect(unmarked.percentage).toBeNull();

        const periodRow = data!.find((r: Record<string, unknown>) => r.section === "Period")!;
        expect(periodRow.session_status).toBe("not_marked");
        expect(periodRow.marked).toBe(0);

        const { data: yData, error: yError } = await instA.clientAs("principal").rpc("report_attendance_daily", {
          p_institution_id: instA.institutionId,
          p_as_of: nowIso,
          p_day_offset: -1,
        });
        expect(yError).toBeNull();
        const markedYesterday = yData!.find((r: Record<string, unknown>) => r.section === "Marked")!;
        expect(markedYesterday.marked).toBe(1);
        expect(markedYesterday.date).toBe(yesterday);

        // The service-role client scoped to institution B never returns A's sections.
        const { data: bData, error: bError } = await admin.rpc("report_attendance_daily", {
          p_institution_id: instB.institutionId,
          p_as_of: nowIso,
          p_day_offset: 0,
        });
        expect(bError).toBeNull();
        expect(bData).toHaveLength(1);
        expect((bData as Record<string, unknown>[])[0].section).toBe("BSection");

        // A principal of B calling with A's id gets zero rows (RLS on the
        // underlying tables blocks the cross-tenant read even inside this
        // security-invoker function).
        const { data: crossData, error: crossError } = await instB.clientAs("principal").rpc("report_attendance_daily", {
          p_institution_id: instA.institutionId,
          p_as_of: nowIso,
          p_day_offset: 0,
        });
        expect(crossError).toBeNull();
        expect(crossData).toHaveLength(0);
      });
    },
  );
});

describe("public.report_fee_defaulters (0077)", () => {
  it("overdue issued/part_paid only, outstanding exact, min_days_overdue filters, excludes paid/cancelled/not-yet-due", async () => {
    const inst = await createTestInstitution("report-fee-defaulters");
    try {
      const year = await createAcademicYear(inst.institutionId);
      const term = await createTerm(inst.institutionId, year);
      const grade = await createGrade(inst.institutionId);
      const section = await createClassSection(inst.institutionId, grade, year);

      const today = todayInTimezone("Asia/Kolkata");

      const overdueStudent = await insertStudent(inst.institutionId, "ADM-FD-1", { firstName: "Asha", lastName: "Rao" });
      await createEnrolment(inst.institutionId, overdueStudent, section, year);
      await insertInvoice({
        institutionId: inst.institutionId,
        studentId: overdueStudent,
        academicYearId: year,
        termId: term,
        invoiceNo: "INV-FD-1",
        status: "issued",
        total: 1500,
        paidTotal: 0,
        dueOn: addDaysToIso(today, -10),
      });

      const partPaidStudent = await insertStudent(inst.institutionId, "ADM-FD-2");
      await insertInvoice({
        institutionId: inst.institutionId,
        studentId: partPaidStudent,
        academicYearId: year,
        termId: term,
        invoiceNo: "INV-FD-2",
        status: "part_paid",
        total: 2000,
        paidTotal: 500,
        dueOn: addDaysToIso(today, -2),
      });

      const paidStudent = await insertStudent(inst.institutionId, "ADM-FD-3");
      await insertInvoice({
        institutionId: inst.institutionId,
        studentId: paidStudent,
        academicYearId: year,
        termId: term,
        invoiceNo: "INV-FD-3",
        status: "paid",
        total: 1000,
        paidTotal: 1000,
        dueOn: addDaysToIso(today, -10),
      });

      const cancelledStudent = await insertStudent(inst.institutionId, "ADM-FD-4");
      await insertInvoice({
        institutionId: inst.institutionId,
        studentId: cancelledStudent,
        academicYearId: year,
        termId: term,
        invoiceNo: "INV-FD-4",
        status: "cancelled",
        total: 1000,
        paidTotal: 0,
        dueOn: addDaysToIso(today, -10),
      });

      const notYetDueStudent = await insertStudent(inst.institutionId, "ADM-FD-5");
      await insertInvoice({
        institutionId: inst.institutionId,
        studentId: notYetDueStudent,
        academicYearId: year,
        termId: term,
        invoiceNo: "INV-FD-5",
        status: "issued",
        total: 1000,
        paidTotal: 0,
        dueOn: addDaysToIso(today, 10),
      });

      const nowIso = new Date().toISOString();
      const { data, error } = await inst.clientAs("accountant").rpc("report_fee_defaulters", {
        p_institution_id: inst.institutionId,
        p_as_of: nowIso,
        p_min_days_overdue: 0,
      });
      expect(error).toBeNull();
      const rows = data as Record<string, unknown>[];
      expect(rows.map((r) => r.invoice_no)).toEqual(["INV-FD-1", "INV-FD-2"]);

      const asha = rows.find((r) => r.invoice_no === "INV-FD-1")!;
      expect(asha.outstanding).toBe("1500.00");
      expect(asha.student).toBe("Asha Rao");
      expect(asha.grade).not.toBeNull();

      const { data: filtered, error: filteredError } = await inst.clientAs("accountant").rpc("report_fee_defaulters", {
        p_institution_id: inst.institutionId,
        p_as_of: nowIso,
        p_min_days_overdue: 5,
      });
      expect(filteredError).toBeNull();
      expect((filtered as Record<string, unknown>[]).map((r) => r.invoice_no)).toEqual(["INV-FD-1"]);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("documents: report entity (0077)", () => {
  const BUCKET = "tenant-docs";

  it("service role writes a report document; a direct admin insert is blocked; only recipient roles read it", async () => {
    const inst = await createTestInstitution("report-documents");
    try {
      const scheduleId = await createSchedule(inst, "attendance.daily", ["principal"]);
      const path = `${inst.institutionId}/report/${scheduleId}/2026-11-04.csv`;

      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, "date,grade\n", { contentType: "text/csv" });
      expect(uploadError).toBeNull();

      const { data: doc, error: docError } = await admin
        .from("documents")
        .insert({
          institution_id: inst.institutionId,
          entity_type: "report",
          entity_id: scheduleId,
          kind: "scheduled_report",
          file_name: "nightly-attendance-2026-11-04.csv",
          mime: "text/csv",
          size_bytes: 20,
          path,
          created_by: inst.users.admin.id,
          status: "active",
        })
        .select("id")
        .single();
      expect(docError).toBeNull();
      const docId = doc!.id as string;

      const adminAttempt = await inst.clientAs("admin").from("documents").insert({
        institution_id: inst.institutionId,
        entity_type: "report",
        entity_id: scheduleId,
        kind: "scheduled_report",
        file_name: "attempt.csv",
        mime: "text/csv",
        size_bytes: 20,
        path: `${inst.institutionId}/report/${scheduleId}/attempt.csv`,
        created_by: inst.users.admin.id,
      });
      expect(adminAttempt.error).not.toBeNull();
      expect(adminAttempt.error?.code).toBe("42501");

      const { data: principalRows, error: principalError } = await inst
        .clientAs("principal")
        .from("documents")
        .select("id")
        .eq("id", docId);
      expect(principalError).toBeNull();
      expect(principalRows).toEqual([{ id: docId }]);

      const { data: principalDownload, error: principalDownloadError } = await inst.clientAs("principal").storage.from(BUCKET).download(path);
      expect(principalDownloadError).toBeNull();
      expect(principalDownload).not.toBeNull();

      for (const role of ["owner", "admin", "teacher", "accountant", "guardian"] as const) {
        const { data, error } = await inst.clientAs(role).from("documents").select("id").eq("id", docId);
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant reads a finance.defaulters schedule's document when listed as a recipient; principal does not", async () => {
    const inst = await createTestInstitution("report-documents-finance");
    try {
      const scheduleId = await createSchedule(inst, "finance.defaulters", ["accountant"]);
      const path = `${inst.institutionId}/report/${scheduleId}/2026-11-04.csv`;
      await admin.storage.from(BUCKET).upload(path, "admission_no\n", { contentType: "text/csv" });
      const { data: doc } = await admin
        .from("documents")
        .insert({
          institution_id: inst.institutionId,
          entity_type: "report",
          entity_id: scheduleId,
          kind: "scheduled_report",
          file_name: "defaulters-2026-11-04.csv",
          mime: "text/csv",
          size_bytes: 15,
          path,
          created_by: inst.users.admin.id,
          status: "active",
        })
        .select("id")
        .single();
      const docId = doc!.id as string;

      const { data: accountantRows } = await inst.clientAs("accountant").from("documents").select("id").eq("id", docId);
      expect(accountantRows).toEqual([{ id: docId }]);

      const { data: principalRows } = await inst.clientAs("principal").from("documents").select("id").eq("id", docId);
      expect(principalRows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("owner still reads a non-report (student) document unchanged", async () => {
    const inst = await createTestInstitution("report-documents-student-unchanged");
    try {
      const [{ student_id: studentId }] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const { data: doc } = await admin
        .from("documents")
        .insert({
          institution_id: inst.institutionId,
          entity_type: "student",
          entity_id: studentId,
          kind: "id_proof",
          file_name: "file.pdf",
          mime: "application/pdf",
          size_bytes: 1000,
          path: `${inst.institutionId}/student/${studentId}/doc.pdf`,
          created_by: inst.users.admin.id,
          status: "active",
        })
        .select("id")
        .single();

      const { data, error } = await inst.clientAs("owner").from("documents").select("id").eq("id", doc!.id);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: doc!.id }]);
    } finally {
      await inst.cleanup();
    }
  });
});
