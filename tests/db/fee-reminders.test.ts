import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Opt-in mock (same shape as tests/db/invoice-generation.test.ts) — only
// this file's module graph gets it; `sendFeeReminders` calls
// `createClient()` from `@/lib/supabase/server`.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { sendFeeReminders } from "@/modules/finance/reminders.actions";
import { feeReminder } from "@/modules/jobs/handlers/finance.fee_reminder";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M12-T8 — action `finance.reminders.send` (wraps `public.enqueue_fee_
// reminders`, T4) + job `finance.fee_reminder` (06 ruling "Fee reminders").
// Invoices are inserted directly (bypassing RLS, like
// tests/db/finance-aggregates.test.ts's ledger fixtures) — this file tests
// the reminder pipeline, not invoice generation, which has its own tests.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

const AS_OF = "2026-06-01";
const OVERDUE_DUE_ON = "2026-01-01";
const NOT_YET_DUE_ON = "2026-12-01";

function makeJob(institutionId: string, termId: string, asOf = AS_OF, idempotencyKey = "k") {
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "finance.fee_reminder" as const,
    payload: { term_id: termId, as_of: asOf },
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

async function insertInvoice(
  inst: TestInstitution,
  termId: string,
  academicYearId: string,
  studentId: string,
  overrides: Partial<{ status: string; total: number; paidTotal: number; dueOn: string }> = {},
): Promise<string> {
  const status = overrides.status ?? "issued";
  const total = overrides.total ?? 10000;
  const paidTotal = overrides.paidTotal ?? 0;
  const dueOn = overrides.dueOn ?? OVERDUE_DUE_ON;
  const invoiceNo = `INV-${crypto.randomUUID().slice(0, 8)}`;

  const [row] = await sql`
    insert into public.invoices (institution_id, student_id, academic_year_id, term_id, invoice_no, status, subtotal, concession_total, total, paid_total, due_on)
    values (${inst.institutionId}, ${studentId}, ${academicYearId}, ${termId}, ${invoiceNo}, ${status}, ${total}, 0, ${total}, ${paidTotal}, ${dueOn})
    returning id
  `;
  return row.id as string;
}

/** Links the fixture's own guardian as the student's primary, active-membership guardian (the "happy path" recipient). */
async function linkPrimaryGuardian(inst: TestInstitution): Promise<string> {
  const [membership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  const guardianId = membership.guardian_id as string;
  const studentId = await studentIdOf(inst);
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return guardianId;
}

async function studentIdOf(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  return row.student_id as string;
}

async function setupTermFixture(inst: TestInstitution): Promise<{ academicYearId: string; termId: string }> {
  const academicYearId = await createAcademicYear(inst.institutionId);
  const termId = await createTerm(inst.institutionId, academicYearId);
  return { academicYearId, termId };
}

describe("finance.reminders.send action", () => {
  it("accountant sends → job queued with term_id/as_of payload; teacher is forbidden", async () => {
    const inst = await createTestInstitution("fee-reminders-action");
    createdInstitutions.push(inst);
    const { termId } = await setupTermFixture(inst);

    const teacherResult = await callAs(inst, "teacher", sendFeeReminders, { termId });
    expect(teacherResult.ok).toBe(false);
    if (!teacherResult.ok) expect(teacherResult.error.code).toBe("forbidden");

    const result = await callAs(inst, "accountant", sendFeeReminders, { termId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.jobId.length).toBeGreaterThan(0);
    expect(result.data.asOf.length).toBeGreaterThan(0);

    const [job] = await sql`select institution_id, type, payload from public.jobs where id = ${result.data.jobId}::uuid`;
    expect(job.institution_id).toBe(inst.institutionId);
    expect(job.type).toBe("finance.fee_reminder");
    expect(job.payload.term_id).toBe(termId);
    expect(job.payload.as_of).toBe(result.data.asOf);
  });
});

describe("finance.fee_reminder handler", () => {
  it("overdue part-paid invoice with an active primary-guardian membership gets one notification + delivery attempts + one fee_reminders row with the outstanding", async () => {
    const inst = await createTestInstitution("fee-reminders-happy");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const studentId = await studentIdOf(inst);
    await linkPrimaryGuardian(inst);
    const invoiceId = await insertInvoice(inst, termId, academicYearId, studentId, { status: "part_paid", total: 10000, paidTotal: 4000 });

    await feeReminder(makeJob(inst.institutionId, termId), { admin });

    const notifications = await sql`
      select id, recipient_user_id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'
    `;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipient_user_id).toBe(inst.users.guardian.id);

    const attempts = await sql`select channel from public.delivery_attempts where notification_id = ${notifications[0].id}::uuid`;
    expect(attempts.map((a) => a.channel).sort()).toEqual(["email", "in_app", "sms"]);

    const reminders = await sql`select * from public.fee_reminders where invoice_id = ${invoiceId}::uuid`;
    expect(reminders).toHaveLength(1);
    expect(reminders[0].recipient_user_id).toBe(inst.users.guardian.id);
    expect(Number(reminders[0].outstanding)).toBe(6000);
    const reminderDate = reminders[0].reminder_date;
    const reminderDateStr = reminderDate instanceof Date ? reminderDate.toISOString().slice(0, 10) : String(reminderDate).slice(0, 10);
    expect(reminderDateStr).toBe(AS_OF);
  });

  it("paid, not-yet-due, and cancelled invoices are all skipped", async () => {
    const inst = await createTestInstitution("fee-reminders-skip");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const guardianId = await linkPrimaryGuardian(inst);

    // Each case is a separate student — `invoices_one_active_per_student_term_idx`
    // allows only one non-cancelled invoice per (student, term).
    for (const [status, dueOn, paidTotal] of [
      ["paid", OVERDUE_DUE_ON, 10000],
      ["issued", NOT_YET_DUE_ON, 0],
      ["cancelled", OVERDUE_DUE_ON, 0],
    ] as const) {
      const [student] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${`Skip-${status}`}, '2015-01-01', 'other')
        returning id
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${inst.institutionId}, ${guardianId}, ${student.id}, 'father', true, true)
      `;
      await insertInvoice(inst, termId, academicYearId, student.id as string, { status, total: 10000, paidTotal, dueOn });
    }

    await feeReminder(makeJob(inst.institutionId, termId), { admin });

    const notifications = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'
    `;
    expect(notifications).toHaveLength(0);
    const reminders = await sql`select id from public.fee_reminders where institution_id = ${inst.institutionId}::uuid`;
    expect(reminders).toHaveLength(0);
  });

  it("a student whose guardian has no active membership is skipped", async () => {
    const inst = await createTestInstitution("fee-reminders-no-membership");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);

    const [student] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Orphan', '2015-01-01', 'other')
      returning id
    `;
    const [guardian] = await sql`
      insert into public.guardians (institution_id, full_name, phone)
      values (${inst.institutionId}, 'No Portal Guardian', '9811111111')
      returning id
    `;
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'mother', true, false)
    `;
    await insertInvoice(inst, termId, academicYearId, student.id as string, { status: "issued", total: 10000, paidTotal: 0 });

    await expect(feeReminder(makeJob(inst.institutionId, termId), { admin })).resolves.toBeUndefined();

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'`;
    expect(notifications).toHaveLength(0);
  });

  it("a primary guardian linked to two active guardian accounts gets one reminder; the job does not fail", async () => {
    const inst = await createTestInstitution("fee-reminders-two-accounts");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const studentId = await studentIdOf(inst);
    const guardianId = await linkPrimaryGuardian(inst);
    await sql`
      insert into public.memberships (institution_id, user_id, role, status, guardian_id)
      values (${inst.institutionId}, ${inst.users.teacher.id}, 'guardian', 'active', ${guardianId})
    `;
    await insertInvoice(inst, termId, academicYearId, studentId, { status: "issued", total: 10000, paidTotal: 0 });

    await expect(feeReminder(makeJob(inst.institutionId, termId), { admin })).resolves.toBeUndefined();

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'`;
    expect(notifications).toHaveLength(1);
  });

  it("rerunning the job creates no new notification, delivery attempt, or fee_reminders row", async () => {
    const inst = await createTestInstitution("fee-reminders-rerun");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const studentId = await studentIdOf(inst);
    await linkPrimaryGuardian(inst);
    const invoiceId = await insertInvoice(inst, termId, academicYearId, studentId, { status: "issued", total: 10000, paidTotal: 0 });

    await feeReminder(makeJob(inst.institutionId, termId, AS_OF, "k1"), { admin });
    const [notification] = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'
    `;
    const attemptsBefore = await sql`select id from public.delivery_attempts where notification_id = ${notification.id}::uuid`;

    await feeReminder(makeJob(inst.institutionId, termId, AS_OF, "k2"), { admin });

    const notificationsAfter = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'`;
    expect(notificationsAfter).toHaveLength(1);
    const attemptsAfter = await sql`select id from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    expect(attemptsAfter).toHaveLength(attemptsBefore.length);
    const reminders = await sql`select id from public.fee_reminders where invoice_id = ${invoiceId}::uuid`;
    expect(reminders).toHaveLength(1);
  });

  it("a guardian with finance sms disabled gets in-app/email but no sms delivery attempt", async () => {
    const inst = await createTestInstitution("fee-reminders-pref");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const studentId = await studentIdOf(inst);
    await linkPrimaryGuardian(inst);
    await insertInvoice(inst, termId, academicYearId, studentId, { status: "issued", total: 10000, paidTotal: 0 });
    await sql`
      insert into public.notification_preferences (user_id, institution_id, category, channel, enabled)
      values (${inst.users.guardian.id}, ${inst.institutionId}, 'finance', 'sms', false)
    `;

    await feeReminder(makeJob(inst.institutionId, termId), { admin });

    const [notification] = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'
    `;
    const attempts = await sql`select channel from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    const channels = attempts.map((a) => a.channel as string);
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("sms");
  });

  it("an invoice paid between enqueue and run is skipped (state re-read fresh at send)", async () => {
    const inst = await createTestInstitution("fee-reminders-race");
    createdInstitutions.push(inst);
    const { academicYearId, termId } = await setupTermFixture(inst);
    const studentId = await studentIdOf(inst);
    await linkPrimaryGuardian(inst);
    const invoiceId = await insertInvoice(inst, termId, academicYearId, studentId, { status: "issued", total: 10000, paidTotal: 0 });

    // Simulates "paid after enqueue, before the job runs" — the handler
    // must re-read current rows, never the state at enqueue time.
    await sql`update public.invoices set status = 'paid', paid_total = 10000 where id = ${invoiceId}::uuid`;

    await feeReminder(makeJob(inst.institutionId, termId), { admin });

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'fee_reminder'`;
    expect(notifications).toHaveLength(0);
    const reminders = await sql`select id from public.fee_reminders where invoice_id = ${invoiceId}::uuid`;
    expect(reminders).toHaveLength(0);
  });
});
