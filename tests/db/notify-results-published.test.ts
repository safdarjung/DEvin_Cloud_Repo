import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyResultsPublished } from "@/modules/jobs/handlers/index";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// T-019 (lead ruling) — real DB test against the service-role client, same
// shape as tests/db/notifications.test.ts's notify.attendance_absence
// suite: recipients (every guardian with an active membership linked to
// the student, plus the student's own active membership — never just the
// primary guardian, unlike that file's handlers), idempotency, and the
// "must still be current and published" re-check.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

function makeJob(institutionId: string, resultId: string, idempotencyKey = "k") {
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "notify.results_published" as const,
    payload: { result_id: resultId },
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

/** One published exam + result for the fixture's own "student"/"guardian" roles, linked via guardian_students (same shape as tests/db/notifications.test.ts's makeAbsenceFixture). A second, unlinked guardian is added too, to prove every linked guardian is notified, not only the primary one. */
async function makeResultFixture(inst: TestInstitution) {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [term] = await sql`
    insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
    values (${inst.institutionId}, ${year.id}, 'Term 1', 1, '2026-04-01', '2026-09-30')
    returning id
  `;
  const [exam] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${inst.institutionId}, ${year.id}, ${term.id}, 'Unit Test (notif)', 'unit_test', 'published')
    returning id
  `;

  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  const [guardian] = await sql`select phone from public.guardians where id = ${guardianMembership.guardian_id}`;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true)
  `;

  // A second guardian, not the primary, with its own membership — proves
  // notify.results_published notifies every linked guardian, not just the
  // primary one (unlike notify.attendance_absence/enrolment_welcome).
  const { data: secondAuthUser, error: secondAuthError } = await admin.auth.admin.createUser({
    email: `second-guardian-${crypto.randomUUID()}@test.coolskool.test`,
    password: "correct-horse-battery-staple",
    email_confirm: true,
  });
  if (secondAuthError || !secondAuthUser.user) throw secondAuthError ?? new Error("failed to create second guardian");
  const [secondGuardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, 'Second Guardian', '9811111111')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${secondAuthUser.user.id}, 'guardian', ${secondGuardian.id})
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${secondGuardian.id}, ${studentId}, 'mother', false)
  `;

  const [result] = await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (${inst.institutionId}, ${exam.id}, ${studentId}, '{"subjects": [], "attendancePercentage": 0}'::jsonb, 80, 100, 80, 'A2', 1, now())
    returning id
  `;

  return {
    examId: exam.id as string,
    studentId,
    resultId: result.id as string,
    guardianUserId: inst.users.guardian.id,
    guardianPhone: guardian.phone as string,
    secondGuardianUserId: secondAuthUser.user.id,
    studentUserId: inst.users.student.id,
  };
}

describe("notify.results_published handler (T-019)", () => {
  it("notifies every linked guardian and the student's own membership, in-app and SMS, and is idempotent on rerun", async () => {
    const inst = await createTestInstitution("notif-results");
    createdInstitutions.push(inst);
    const { resultId, guardianUserId, guardianPhone, secondGuardianUserId, studentUserId } =
      await makeResultFixture(inst);

    await notifyResultsPublished(makeJob(inst.institutionId, resultId), { admin });

    const notifications = await sql`
      select recipient_user_id, type, body from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'results_published'
    `;
    const recipientIds = notifications.map((n) => n.recipient_user_id).sort();
    expect(recipientIds).toEqual([guardianUserId, secondGuardianUserId, studentUserId].sort());

    const [primaryWithId] = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${guardianUserId}::uuid and type = 'results_published'
    `;
    const primaryAttempts = await sql`
      select channel, status, to_address from public.delivery_attempts where notification_id = ${primaryWithId.id}::uuid order by channel
    `;
    expect(primaryAttempts.map((a) => a.channel).sort()).toEqual(["in_app", "sms", "whatsapp"]);
    const sms = primaryAttempts.find((a) => a.channel === "sms");
    expect(sms?.status).toBe("simulated");
    expect(sms?.to_address).toBe(guardianPhone);

    // Student recipient has no phone column on `students` — sms channel
    // records a "failed: no_contact" attempt, never crashes the handler.
    const [studentNotification] = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${studentUserId}::uuid
    `;
    const studentSms = await sql`
      select status, error from public.delivery_attempts where notification_id = ${studentNotification.id}::uuid and channel = 'sms'
    `;
    expect(studentSms[0]?.status).toBe("failed");

    // Idempotent rerun: same counts, no duplicate notifications or attempts.
    await notifyResultsPublished(makeJob(inst.institutionId, resultId), { admin });
    const notificationsAfter = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'results_published'
    `;
    expect(notificationsAfter).toHaveLength(3);
    const attemptsAfter = await sql`
      select id from public.delivery_attempts where notification_id = ${primaryWithId.id}::uuid
    `;
    expect(attemptsAfter).toHaveLength(3);
  });

  it("re-check at send time: skips (no-op, no throw) when the result has since been superseded by a recheck correction", async () => {
    const inst = await createTestInstitution("notif-results-superseded");
    createdInstitutions.push(inst);
    const { resultId, studentId, examId } = await makeResultFixture(inst);

    // Same ordering as app.apply_recheck_decision: insert the new current
    // row, then point the old one at it — both in one transaction, since
    // "one current row" is a deferred constraint checked at commit (0009),
    // not per statement.
    await sql.begin(async (tx) => {
      const [newResult] = await tx`
        insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
        values (${inst.institutionId}, ${examId}, ${studentId}, '{"subjects": [], "attendancePercentage": 0}'::jsonb, 90, 100, 90, 'A2', 2, now())
        returning id
      `;
      await tx`update public.results set superseded_by = ${newResult.id} where id = ${resultId}`;
    });

    await expect(notifyResultsPublished(makeJob(inst.institutionId, resultId), { admin })).resolves.toBeUndefined();

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notifications).toHaveLength(0);
  });

  it("re-check at send time: skips when the result row no longer exists (deleted/stale job)", async () => {
    const inst = await createTestInstitution("notif-results-missing");
    createdInstitutions.push(inst);

    await expect(
      notifyResultsPublished(makeJob(inst.institutionId, crypto.randomUUID()), { admin }),
    ).resolves.toBeUndefined();

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notifications).toHaveLength(0);
  });

  it("a disabled guardian membership gets no notification", async () => {
    const inst = await createTestInstitution("notif-results-disabled");
    createdInstitutions.push(inst);
    const { resultId, guardianUserId } = await makeResultFixture(inst);
    await sql`update public.memberships set status = 'disabled' where institution_id = ${inst.institutionId}::uuid and user_id = ${guardianUserId}::uuid and role = 'guardian'`;

    await notifyResultsPublished(makeJob(inst.institutionId, resultId), { admin });

    const notified = await sql`select recipient_user_id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notified.map((n) => n.recipient_user_id)).not.toContain(guardianUserId);
  });
});
