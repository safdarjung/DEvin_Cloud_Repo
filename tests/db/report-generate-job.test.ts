// M15-T9 — job handler `report.generate` against the real DB (service-role
// client, real storage/rpc), same shape as tests/db/notify-announcement.test.ts
// (handler called directly, no runner) and the fixtures from
// tests/db/report-sources-rls.test.ts (attendance/invoice builders).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { generateReport } from "@/modules/jobs/handlers/index";
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
const BUCKET = "tenant-docs";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createSchedule(
  inst: TestInstitution,
  opts: { source: string; recipientRoles: string[]; createdBy?: string },
): Promise<string> {
  const { data, error } = await admin
    .from("scheduled_reports")
    .insert({
      institution_id: inst.institutionId,
      name: `Schedule ${crypto.randomUUID().slice(0, 8)}`,
      source: opts.source,
      cron: "0 20 * * *",
      recipient_roles: opts.recipientRoles,
      created_by: opts.createdBy ?? inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create schedule fixture");
  return data.id as string;
}

function makeJob(scheduledReportId: string, fireAt: string, idempotencyKey = "k") {
  return {
    id: crypto.randomUUID(),
    institution_id: null,
    type: "report.generate" as const,
    payload: { scheduled_report_id: scheduledReportId, fire_at: fireAt },
    idempotency_key: idempotencyKey,
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function reportDocuments(institutionId: string, scheduleId: string) {
  return sql`
    select id, entity_type, entity_id, mime, status, created_by, path, file_name
    from public.documents
    where institution_id = ${institutionId}::uuid and entity_type = 'report' and entity_id = ${scheduleId}::uuid
  `;
}

async function notificationsFor(institutionId: string, userId: string) {
  return sql`
    select id from public.notifications
    where institution_id = ${institutionId}::uuid and recipient_user_id = ${userId}::uuid and type = 'report_ready'
  `;
}

describe("report.generate handler (M15-T9)", () => {
  it(
    "writes one CSV document (9-column attendance header, one row per section), notifies active " +
      "principal-role recipients, skips a deactivated one, and never leaks another institution's rows",
    async () => {
      await withTwoInstitutions(async (instA, instB) => {
        await setAttendanceStatuses(instA.institutionId);

        const yearA = await createAcademicYear(instA.institutionId);
        const gradeA = await createGrade(instA.institutionId);
        const sectionA1 = await createClassSection(instA.institutionId, gradeA, yearA, { name: "A1" });
        await createClassSection(instA.institutionId, gradeA, yearA, { name: "A2" });
        const s1 = await insertStudent(instA.institutionId, "ADM-JOB-1");
        await createEnrolment(instA.institutionId, s1, sectionA1, yearA);
        const session = await createAttendanceSession(instA.institutionId, sectionA1, { status: "submitted" });
        await createAttendanceRecord(instA.institutionId, session, s1, { status: "P" });

        // Institution B's own section — must never appear in A's report.
        const yearB = await createAcademicYear(instB.institutionId);
        const gradeB = await createGrade(instB.institutionId);
        await createClassSection(instB.institutionId, gradeB, yearB, { name: "LeakSection" });

        // A second active principal, and a deactivated one, on institution A.
        async function addPrincipal(status: "active" | "disabled") {
          const email = `extra-principal-${status}-${crypto.randomUUID()}@test.coolskool.test`;
          const { data: authUser, error: authError } = await admin.auth.admin.createUser({
            email,
            password: "correct-horse-battery-staple",
            email_confirm: true,
          });
          if (authError || !authUser.user) throw authError ?? new Error("failed to create extra principal");
          const [staff] = await sql`
            insert into public.staff (institution_id, employee_no, full_name, designation)
            values (${instA.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Extra Principal', 'principal')
            returning id
          `;
          await sql`
            insert into public.memberships (institution_id, user_id, role, staff_id, status)
            values (${instA.institutionId}, ${authUser.user.id}, 'principal', ${staff.id}, ${status})
          `;
          return authUser.user.id as string;
        }
        const extraActivePrincipalId = await addPrincipal("active");
        const extraInactivePrincipalId = await addPrincipal("disabled");

        const scheduleId = await createSchedule(instA, { source: "attendance.daily", recipientRoles: ["principal"] });
        const fireAt = new Date().toISOString();

        await generateReport(makeJob(scheduleId, fireAt), { admin });

        const docs = await reportDocuments(instA.institutionId, scheduleId);
        expect(docs).toHaveLength(1);
        const doc = docs[0];
        expect(doc.entity_type).toBe("report");
        expect(doc.mime).toBe("text/csv");
        expect(doc.status).toBe("active");
        expect(doc.created_by).toBe(instA.users.admin.id);

        const { data: downloaded, error: downloadError } = await admin.storage.from(BUCKET).download(doc.path as string);
        expect(downloadError).toBeNull();
        const csvText = await (downloaded as Blob).text();
        const lines = csvText.split("\r\n");
        expect(lines[0]).toBe("date,grade,section,session_status,enrolled,marked,present_weighted,denominator,percentage");
        expect(lines).toHaveLength(3); // header + 2 sections
        expect(csvText).not.toContain("LeakSection");

        const principalNotifications = await notificationsFor(instA.institutionId, instA.users.principal.id);
        expect(principalNotifications).toHaveLength(1);
        const extraActiveNotifications = await notificationsFor(instA.institutionId, extraActivePrincipalId);
        expect(extraActiveNotifications).toHaveLength(1);
        const extraInactiveNotifications = await notificationsFor(instA.institutionId, extraInactivePrincipalId);
        expect(extraInactiveNotifications).toHaveLength(0);

        // Re-run the same window (retry/replay) -> still one document, no new notification.
        await generateReport(makeJob(scheduleId, fireAt, "k2"), { admin });
        const docsAfter = await reportDocuments(instA.institutionId, scheduleId);
        expect(docsAfter).toHaveLength(1);
        expect(docsAfter[0].id).toBe(doc.id);
        const principalNotificationsAfter = await notificationsFor(instA.institutionId, instA.users.principal.id);
        expect(principalNotificationsAfter).toHaveLength(1);
      });
    },
  );

  it("schedule paused after enqueue produces no document", async () => {
    const inst = await createTestInstitution("report-job-paused");
    createdInstitutions.push(inst);
    const scheduleId = await createSchedule(inst, { source: "attendance.daily", recipientRoles: ["principal"] });
    await sql`update public.scheduled_reports set status = 'paused' where id = ${scheduleId}::uuid`;

    await expect(generateReport(makeJob(scheduleId, new Date().toISOString()), { admin })).resolves.toBeUndefined();

    const docs = await reportDocuments(inst.institutionId, scheduleId);
    expect(docs).toHaveLength(0);
  });

  it("finance.defaulters source: outstanding cells exact, accountant notified", async () => {
    const inst = await createTestInstitution("report-job-finance");
    createdInstitutions.push(inst);
    const year = await createAcademicYear(inst.institutionId);
    const term = await createTerm(inst.institutionId, year);
    const grade = await createGrade(inst.institutionId);
    const section = await createClassSection(inst.institutionId, grade, year);
    const studentId = await insertStudent(inst.institutionId, "ADM-JOB-FD-1");
    await createEnrolment(inst.institutionId, studentId, section, year);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const dueOn = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 10);
      return d.toISOString().slice(0, 10);
    })();
    await sql`
      insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, total, paid_total, due_on)
      values (${inst.institutionId}, ${studentId}, ${year}, ${term}, 'INV-JOB-1', 'issued', 1500, 0, ${dueOn})
    `;

    const scheduleId = await createSchedule(inst, {
      source: "finance.defaulters",
      recipientRoles: ["accountant"],
      createdBy: inst.users.accountant.id,
    });
    const fireAt = new Date().toISOString();

    await generateReport(makeJob(scheduleId, fireAt), { admin });

    const docs = await reportDocuments(inst.institutionId, scheduleId);
    expect(docs).toHaveLength(1);
    expect(docs[0].created_by).toBe(inst.users.accountant.id);

    const { data: downloaded } = await admin.storage.from(BUCKET).download(docs[0].path as string);
    const csvText = await (downloaded as Blob).text();
    expect(csvText).toContain("1500.00");

    const accountantNotifications = await notificationsFor(inst.institutionId, inst.users.accountant.id);
    expect(accountantNotifications).toHaveLength(1);
  });
});
