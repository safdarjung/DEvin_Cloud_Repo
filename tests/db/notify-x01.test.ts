import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyDiaryEntry, notifyStudentLeaveDecided } from "@/modules/jobs/handlers/index";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X01-T10 — notify.student_leave_decided + notify.diary_entry handlers.
// Same real-DB, direct-handler-call shape as tests/db/notify-announcement.test.ts.
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

function makeJob(institutionId: string, type: "notify.student_leave_decided" | "notify.diary_entry", payload: Record<string, unknown>, idempotencyKey = "k") {
  return {
    id: "job-1",
    institution_id: institutionId,
    type,
    payload,
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

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isSunday(offsetDays: number): boolean {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.getUTCDay() === 0;
}

/** Nearest offset from `start` (searching forward) that isn't a Sunday. */
function safeOffset(start: number): number {
  let offset = start;
  while (isSunday(offset)) offset += 1;
  return offset;
}

/** Year + section (class teacher = fixture's teacher) + fixture's student enrolled + fixture's guardian linked. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const [teacherStaff] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff.staff_id as string });
  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
  `;
  const studentId = studentMembership.student_id as string;
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
  `;
  const guardianId = guardianMembership.guardian_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionId, studentId, guardianId };
}

describe("notify.student_leave_decided handler", () => {
  it("approved leave notifies the guardian and student, body omits the reason, sms attempted by default", async () => {
    const inst = await createTestInstitution("notif-leave-approved");
    createdInstitutions.push(inst);
    const base = await makeBase(inst);

    const { data: leave, error: insertError } = await inst
      .clientAs("guardian")
      .from("student_leave_requests")
      .insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: base.sectionId,
        start_date: isoDate(safeOffset(5)),
        end_date: isoDate(safeOffset(5)),
        reason: "Family function",
      })
      .select("id")
      .single();
    if (insertError || !leave) throw insertError ?? new Error("leave insert failed");

    const decide = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.id, p_decision: "approved" });
    expect(decide.error).toBeNull();

    await notifyStudentLeaveDecided(makeJob(inst.institutionId, "notify.student_leave_decided", { leave_id: leave.id }), { admin });

    const notified = await sql`
      select recipient_user_id, body from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'student_leave_decided'
    `;
    const recipientIds = notified.map((n) => n.recipient_user_id as string);
    expect(recipientIds).toContain(inst.users.guardian.id);
    expect(recipientIds).toContain(inst.users.student.id);
    for (const row of notified) {
      expect(row.body as string).not.toContain("Family function");
      expect(row.body as string).toContain("approved");
    }

    const attempts = await sql`
      select channel from public.delivery_attempts
      where notification_id = (
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'student_leave_decided'
      )
    `;
    expect(attempts.map((a) => a.channel as string)).toEqual(expect.arrayContaining(["in_app", "sms"]));
  }, 20_000);

  it("a guardian with sms disabled for 'attendance' gets in-app but no sms delivery attempt", async () => {
    const inst = await createTestInstitution("notif-leave-pref");
    createdInstitutions.push(inst);
    const base = await makeBase(inst);
    await sql`
      insert into public.notification_preferences (user_id, institution_id, category, channel, enabled)
      values (${inst.users.guardian.id}, ${inst.institutionId}, 'attendance', 'sms', false)
    `;

    const { data: leave, error: insertError } = await inst
      .clientAs("guardian")
      .from("student_leave_requests")
      .insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: base.sectionId,
        start_date: isoDate(safeOffset(5)),
        end_date: isoDate(safeOffset(5)),
        reason: "Medical",
      })
      .select("id")
      .single();
    if (insertError || !leave) throw insertError ?? new Error("leave insert failed");

    const decide = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.id, p_decision: "rejected" });
    expect(decide.error).toBeNull();

    await notifyStudentLeaveDecided(makeJob(inst.institutionId, "notify.student_leave_decided", { leave_id: leave.id }), { admin });

    const attempts = await sql`
      select channel from public.delivery_attempts
      where notification_id = (
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'student_leave_decided'
      )
    `;
    const channels = attempts.map((a) => a.channel as string);
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("sms");

    const [notification] = await sql`
      select body from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'student_leave_decided'
    `;
    expect(notification.body as string).toContain("rejected");
  }, 20_000);

  it("rerunning the job creates no new notification or delivery attempts", async () => {
    const inst = await createTestInstitution("notif-leave-rerun");
    createdInstitutions.push(inst);
    const base = await makeBase(inst);

    const { data: leave, error: insertError } = await inst
      .clientAs("guardian")
      .from("student_leave_requests")
      .insert({
        institution_id: inst.institutionId,
        student_id: base.studentId,
        class_section_id: base.sectionId,
        start_date: isoDate(safeOffset(5)),
        end_date: isoDate(safeOffset(5)),
        reason: "Family function",
      })
      .select("id")
      .single();
    if (insertError || !leave) throw insertError ?? new Error("leave insert failed");

    const decide = await inst.clientAs("teacher").rpc("decide_student_leave", { p_leave_id: leave.id, p_decision: "approved" });
    expect(decide.error).toBeNull();

    await notifyStudentLeaveDecided(makeJob(inst.institutionId, "notify.student_leave_decided", { leave_id: leave.id }, "k1"), { admin });
    const before = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'student_leave_decided'`;

    await notifyStudentLeaveDecided(makeJob(inst.institutionId, "notify.student_leave_decided", { leave_id: leave.id }, "k2"), { admin });
    const after = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'student_leave_decided'`;

    expect(after).toHaveLength(before.length);
  }, 20_000);
});

describe("notify.diary_entry handler", () => {
  it("notifies only that section's guardians and students, in-app only", async () => {
    const inst = await createTestInstitution("notif-diary-section");
    createdInstitutions.push(inst);
    const base = await makeBase(inst);

    // A second section + its own student/guardian, to prove isolation.
    const sectionBId = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B" });
    const [studentB] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Student B', '2015-01-01', 'other')
      returning id
    `;
    await createEnrolment(inst.institutionId, studentB.id as string, sectionBId, base.yearId, { status: "active" });
    const { data: secondAuthUser, error: secondAuthError } = await admin.auth.admin.createUser({
      email: `second-guardian-${crypto.randomUUID()}@test.coolskool.test`,
      password: "correct-horse-battery-staple",
      email_confirm: true,
    });
    if (secondAuthError || !secondAuthUser.user) throw secondAuthError ?? new Error("failed to create second guardian");
    const [guardianB] = await sql`
      insert into public.guardians (institution_id, full_name, phone)
      values (${inst.institutionId}, 'Guardian B', '9822222222')
      returning id
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, guardian_id)
      values (${inst.institutionId}, ${secondAuthUser.user.id}, 'guardian', ${guardianB.id})
    `;
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${guardianB.id}, ${studentB.id}, 'mother', true, true)
    `;

    const { data: entry, error: entryError } = await inst
      .clientAs("teacher")
      .from("diary_entries")
      .insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: isoDate(0),
        body: "No homework today.",
        created_by: inst.users.teacher.id,
      })
      .select("id")
      .single();
    if (entryError || !entry) throw entryError ?? new Error("diary entry insert failed");

    await notifyDiaryEntry(makeJob(inst.institutionId, "notify.diary_entry", { entry_id: entry.id }), { admin });

    const notified = await sql`
      select recipient_user_id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'diary_entry'
    `;
    const recipientIds = notified.map((n) => n.recipient_user_id as string);
    expect(recipientIds).toContain(inst.users.guardian.id);
    expect(recipientIds).toContain(inst.users.student.id);
    expect(recipientIds).not.toContain(secondAuthUser.user.id);

    const attempts = await sql`
      select channel from public.delivery_attempts
      where notification_id = (
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'diary_entry'
      )
    `;
    expect(attempts.map((a) => a.channel as string)).toEqual(["in_app"]);
  }, 20_000);

  it("a job for a deleted entry sends no notification and does not throw", async () => {
    const inst = await createTestInstitution("notif-diary-deleted");
    createdInstitutions.push(inst);
    const base = await makeBase(inst);

    const { data: entry, error: entryError } = await inst
      .clientAs("teacher")
      .from("diary_entries")
      .insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: isoDate(0),
        body: "Will be deleted.",
        created_by: inst.users.teacher.id,
      })
      .select("id")
      .single();
    if (entryError || !entry) throw entryError ?? new Error("diary entry insert failed");

    const del = await inst.clientAs("teacher").from("diary_entries").delete().eq("id", entry.id as string);
    expect(del.error).toBeNull();

    await expect(
      notifyDiaryEntry(makeJob(inst.institutionId, "notify.diary_entry", { entry_id: entry.id }), { admin }),
    ).resolves.toBeUndefined();

    const notified = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'diary_entry'`;
    expect(notified).toHaveLength(0);
  }, 20_000);
});
