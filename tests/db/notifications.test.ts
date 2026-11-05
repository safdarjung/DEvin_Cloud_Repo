import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyAttendanceAbsence, notifyEnquiryReceived } from "@/modules/jobs/handlers/index";
import { createNotification } from "@/modules/notifications/service";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// T-038 — real DB test against the service-role client, the real
// `notifications`/`delivery_attempts` tables and their RLS (0003). Mirrors
// tests/db/jobs.test.ts's shape: service-role admin for fixture setup and
// for exercising handlers directly (handlers always run under the service
// role via the runner, 06 §W12), role-signed-in clients for the RLS checks.
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

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = '{
      "attendance": {
        "statuses": [
          { "code": "P", "label": "Present", "counts_present": 1, "in_denominator": true },
          { "code": "A", "label": "Absent", "counts_present": 0, "in_denominator": true, "notify_guardian": true }
        ]
      },
      "communication": { "languages": ["en", "hi"] }
    }'::jsonb
    where id = ${institutionId}::uuid
  `;
}

async function makeAbsenceFixture(inst: TestInstitution) {
  await setAttendanceSettings(inst.institutionId);

  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, 'VI', 'Grade VI', 6, 'middle')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;
  const [session] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date)
    values (${inst.institutionId}, ${section.id}, '2026-10-29')
    returning id
  `;

  // Link the fixture's own student/guardian as a primary guardian pair
  // (createTestInstitution creates them with no `user_id` on the
  // students/guardians row itself — only `memberships` links the auth user
  // to `student_id`/`guardian_id` — so resolve both through memberships).
  const [student] = await sql`
    select student_id as id from public.memberships
    where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const guardianUserId = inst.users.guardian.id;
  const [membership] = await sql`
    select guardian_id from public.memberships
    where institution_id = ${inst.institutionId} and user_id = ${guardianUserId}
  `;
  const [guardian] = await sql`select id, phone from public.guardians where id = ${membership.guardian_id}`;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'father', true)
  `;

  const [record] = await sql`
    insert into public.attendance_records (institution_id, session_id, student_id, status)
    values (${inst.institutionId}, ${session.id}, ${student.id}, 'A')
    returning id
  `;

  return { recordId: record.id as string, guardianPhone: guardian.phone as string, guardianUserId };
}

describe("notify.attendance_absence handler (06 §W5)", () => {
  it("notifies the primary guardian in-app and with a simulated SMS, and is idempotent on rerun", async () => {
    const inst = await createTestInstitution("notif-absence");
    createdInstitutions.push(inst);
    const { recordId, guardianUserId } = await makeAbsenceFixture(inst);

    await notifyAttendanceAbsence({ id: "job-1", institution_id: inst.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const notifications = await sql`
      select id, title, body, type from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${guardianUserId}::uuid
    `;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("attendance_absence");

    const attempts = await sql`
      select channel, status, rendered_body from public.delivery_attempts
      where notification_id = ${notifications[0].id}::uuid
      order by channel
    `;
    // X05-T3 — this fixture is is_demo true (createTestInstitution), so
    // whatsapp is always simulatedWhatsApp here too.
    expect(attempts.map((a) => a.channel).sort()).toEqual(["in_app", "sms", "whatsapp"]);
    const sms = attempts.find((a) => a.channel === "sms");
    expect(sms?.status).toBe("simulated");
    expect(sms?.rendered_body).toContain("absent");

    // Rerun: acceptance criterion 4 — re-running leaves counts unchanged.
    await notifyAttendanceAbsence({ id: "job-1", institution_id: inst.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k", status: "running", attempts: 2, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const notificationsAfter = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${guardianUserId}::uuid
    `;
    expect(notificationsAfter).toHaveLength(1);
    const attemptsAfter = await sql`select id from public.delivery_attempts where notification_id = ${notifications[0].id}::uuid`;
    expect(attemptsAfter).toHaveLength(3);
  });

  it("C-30: another guardian cannot read this guardian's notification", async () => {
    const instA = await createTestInstitution("notif-c30-a");
    const instB = await createTestInstitution("notif-c30-b");
    createdInstitutions.push(instA, instB);
    const { recordId, guardianUserId } = await makeAbsenceFixture(instA);

    await notifyAttendanceAbsence({ id: "job-2", institution_id: instA.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k2", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const [notification] = await sql`select id from public.notifications where recipient_user_id = ${guardianUserId}::uuid`;

    const ownRead = await instA.clientAs("guardian").from("notifications").select("id").eq("id", notification.id);
    expect(ownRead.data).toHaveLength(1);

    const otherRead = await instB.clientAs("guardian").from("notifications").select("id").eq("id", notification.id);
    expect(otherRead.data).toHaveLength(0);
  });

  it("skips (no-op, no throw) when the attendance record no longer warrants notification", async () => {
    const inst = await createTestInstitution("notif-skip");
    createdInstitutions.push(inst);
    const { recordId } = await makeAbsenceFixture(inst);
    await sql`update public.attendance_records set status = 'P' where id = ${recordId}::uuid`;

    await expect(
      notifyAttendanceAbsence({ id: "job-3", institution_id: inst.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k3", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin }),
    ).resolves.toBeUndefined();

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notifications).toHaveLength(0);
  });

  it("Fix round 1 (HIGH, C-02): a guardian with a disabled membership gets no notification and no delivery_attempts", async () => {
    const inst = await createTestInstitution("notif-disabled-guardian");
    createdInstitutions.push(inst);
    const { recordId, guardianUserId } = await makeAbsenceFixture(inst);
    await sql`update public.memberships set status = 'disabled' where institution_id = ${inst.institutionId}::uuid and user_id = ${guardianUserId}::uuid and role = 'guardian'`;

    await notifyAttendanceAbsence({ id: "job-disabled", institution_id: inst.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k-disabled", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notifications).toHaveLength(0);
    const attempts = await sql`select id from public.delivery_attempts where institution_id = ${inst.institutionId}::uuid`;
    expect(attempts).toHaveLength(0);
  });
});

describe("notify.enquiry_received handler (06 §W3/§3)", () => {
  it("notifies every admissions-role member, built from the enquiry row (not the payload)", async () => {
    const inst = await createTestInstitution("notif-enquiry");
    createdInstitutions.push(inst);

    const [enquiry] = await sql`
      insert into public.enquiries (institution_id, child_name, guardian_name, phone, source, status)
      values (${inst.institutionId}, 'Child Name', 'Guardian Name', '9876543210', 'website', 'new')
      returning id
    `;

    await notifyEnquiryReceived({ id: "job-4", institution_id: inst.institutionId, type: "notify.enquiry_received", payload: { enquiry_id: enquiry.id, child_name: "tampered", guardian_name: "tampered", phone: "0000000000" }, idempotency_key: "k4", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const notifications = await sql`
      select recipient_user_id, body from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'enquiry_received'
    `;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipient_user_id).toBe(inst.users.admissions.id);
    // Built from the real `enquiries` row, not the tampered payload fields.
    expect(notifications[0].body).toContain("Child Name");
    expect(notifications[0].body).toContain("Guardian Name");
    expect(notifications[0].body).not.toContain("tampered");
  });

  it("Fix round 1 (HIGH, C-02): a disabled admissions membership is not notified", async () => {
    const inst = await createTestInstitution("notif-enquiry-disabled");
    createdInstitutions.push(inst);
    await sql`update public.memberships set status = 'disabled' where institution_id = ${inst.institutionId}::uuid and role = 'admissions'`;

    const [enquiry] = await sql`
      insert into public.enquiries (institution_id, child_name, guardian_name, phone, source, status)
      values (${inst.institutionId}, 'Child Name', 'Guardian Name', '9876543210', 'website', 'new')
      returning id
    `;

    await notifyEnquiryReceived({ id: "job-disabled-admissions", institution_id: inst.institutionId, type: "notify.enquiry_received", payload: { enquiry_id: enquiry.id }, idempotency_key: "k-disabled-admissions", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const notifications = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notifications).toHaveLength(0);
  });
});

describe("message log (07 §2.2 notification.log.read, 07 §3 confidential)", () => {
  it("C-31: a teacher cannot read the delivery log; an admin can, and SMS rows carry no provider ref", async () => {
    const inst = await createTestInstitution("notif-c31");
    createdInstitutions.push(inst);
    const { recordId } = await makeAbsenceFixture(inst);

    await notifyAttendanceAbsence({ id: "job-5", institution_id: inst.institutionId, type: "notify.attendance_absence", payload: { record_id: recordId }, idempotency_key: "k5", status: "running", attempts: 1, max_attempts: 5, run_after: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { admin });

    const teacherRead = await inst.clientAs("teacher").from("delivery_attempts").select("id").eq("institution_id", inst.institutionId);
    expect(teacherRead.data).toHaveLength(0);

    const adminRead = await inst.clientAs("admin").from("delivery_attempts").select("id, channel, status, provider, provider_ref").eq("institution_id", inst.institutionId);
    expect(adminRead.data?.length).toBeGreaterThan(0);
    for (const row of adminRead.data ?? []) {
      expect(row.provider_ref).toBeNull();
      if (row.channel === "sms") expect(row.status).toBe("simulated");
    }
  });
});

describe("createNotification idempotency (unique key)", () => {
  it("a second call with the same (type, entityId, recipient) creates no new notification or delivery attempts", async () => {
    const inst = await createTestInstitution("notif-service-idem");
    createdInstitutions.push(inst);
    const recipient = inst.users.guardian.id;
    const entityId = crypto.randomUUID();

    const first = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: recipient,
      type: "enquiry_received",
      entityId,
      vars: { child: "C", grade: "G", guardian: "Gd" },
    });
    expect(first.created).toBe(true);

    const second = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: recipient,
      type: "enquiry_received",
      entityId,
      vars: { child: "C", grade: "G", guardian: "Gd" },
    });
    expect(second.created).toBe(false);
    expect(second.notificationId).toBe(first.notificationId);

    const rows = await sql`select id from public.notifications where id = ${first.notificationId}::uuid`;
    expect(rows).toHaveLength(1);
  });

  it("Fix round 1 (MEDIUM): a retry after a partial failure backfills only the missing channel, once", async () => {
    const inst = await createTestInstitution("notif-service-partial");
    createdInstitutions.push(inst);
    const recipient = inst.users.guardian.id;
    const entityId = crypto.randomUUID();
    const vars = { student: "A", class: "X-A", date: "2026-10-29", school: "S" };

    // Simulate the first run crashing after the notification insert and the
    // first channel's (in_app) delivery_attempts insert, but before sms.
    const key = `attendance_absence:${entityId}:${recipient}`;
    const [notification] = await sql`
      insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
      values (${inst.institutionId}, ${recipient}, 'attendance_absence', 'Attendance: Absent', 'body',
        jsonb_build_object('key', ${key}::text))
      returning id
    `;
    await sql`
      insert into public.delivery_attempts (institution_id, notification_id, channel, status, rendered_body)
      values (${inst.institutionId}, ${notification.id}, 'in_app', 'sent', 'body')
    `;

    const retry = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: recipient,
      type: "attendance_absence",
      entityId,
      vars,
      contacts: { sms: "9876543210" },
    });
    expect(retry.created).toBe(false);
    expect(retry.notificationId).toBe(notification.id);

    const attempts = await sql`select channel from public.delivery_attempts where notification_id = ${notification.id}::uuid order by channel`;
    expect(attempts.map((a) => a.channel)).toEqual(["in_app", "sms", "whatsapp"]);

    // Idempotent: a second retry does not add a fourth attempt.
    await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: recipient,
      type: "attendance_absence",
      entityId,
      vars,
      contacts: { sms: "9876543210" },
    });
    const attemptsAfter = await sql`select id from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    expect(attemptsAfter).toHaveLength(3);
  });
});
