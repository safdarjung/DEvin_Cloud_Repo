import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { notifyAnnouncement } from "@/modules/jobs/handlers/index";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M06-T3 — real DB test against the service-role client, same shape as
// tests/db/notify-results-published.test.ts: recipients resolved from
// current enrolment/guardian_students/membership rows (never the payload),
// idempotency, and `notification_preferences` honoured.
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

function makeJob(institutionId: string, announcementId: string, idempotencyKey = "k") {
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "notify.announcement" as const,
    payload: { announcement_id: announcementId },
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

async function publishAnnouncement(
  inst: TestInstitution,
  audience: { audience_type: "school" | "role" | "grade" | "section"; role?: string; grade_id?: string; class_section_id?: string },
): Promise<string> {
  const { data: draft, error: draftError } = await inst
    .clientAs("admin")
    .from("announcements")
    .insert({ institution_id: inst.institutionId, title: "Holiday notice", body: "School closed Friday for a festival.", created_by: inst.users.admin.id })
    .select("id")
    .single();
  if (draftError || !draft) throw draftError ?? new Error("draft insert failed");

  const { error: audienceError } = await inst.clientAs("admin").from("announcement_audiences").insert({
    announcement_id: draft.id,
    institution_id: inst.institutionId,
    audience_type: audience.audience_type,
    role: audience.role ?? null,
    grade_id: audience.grade_id ?? null,
    class_section_id: audience.class_section_id ?? null,
  });
  if (audienceError) throw audienceError;

  const { error: publishError } = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: draft.id });
  if (publishError) throw publishError;

  return draft.id as string;
}

/** Current academic year + grade + two sections (A, B), with the fixture's own student/guardian enrolled in section A. */
async function makeSectionFixture(inst: TestInstitution) {
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
  const [sectionA] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;
  const [sectionB] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'B')
    returning id
  `;

  const [studentAMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentAId = studentAMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentAId}, ${sectionA.id}, ${year.id}, '2026-04-01', 'active')
  `;

  const [guardianAMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianAMembership.guardian_id}, ${studentAId}, 'father', true, true)
  `;

  // Section B's own student + a second, unrelated guardian — proves the
  // section audience only reaches section A, not every guardian.
  const [studentB] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Student B', '2015-01-01', 'other')
    returning id
  `;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentB.id}, ${sectionB.id}, ${year.id}, '2026-04-01', 'active')
  `;
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

  return {
    sectionAId: sectionA.id as string,
    yearId: year.id as string,
    gradeId: grade.id as string,
    guardianBUserId: secondAuthUser.user.id as string,
  };
}

describe("notify.announcement handler (M06-T3)", () => {
  it("section audience notifies that section's guardians and students, not other sections' guardians", async () => {
    const inst = await createTestInstitution("notif-announce-section");
    createdInstitutions.push(inst);
    const { sectionAId, guardianBUserId } = await makeSectionFixture(inst);

    const announcementId = await publishAnnouncement(inst, { audience_type: "section", class_section_id: sectionAId });
    await notifyAnnouncement(makeJob(inst.institutionId, announcementId), { admin });

    const notified = await sql`
      select recipient_user_id, type from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'announcement'
    `;
    const recipientIds = notified.map((n) => n.recipient_user_id as string);
    expect(recipientIds).toContain(inst.users.student.id);
    expect(recipientIds).toContain(inst.users.guardian.id);
    expect(recipientIds).not.toContain(guardianBUserId);
  });

  it("grade audience with 260 students fans out to every guardian/student exactly once (no URI-too-long)", async () => {
    const inst = await createTestInstitution("notif-announce-bigrade");
    createdInstitutions.push(inst);
    const { sectionAId, yearId, gradeId, guardianBUserId } = await makeSectionFixture(inst);

    // 260 students (260 uuids in one .in() overflows PostgREST's URL limit), each with a
    // portal guardian; the first 40 guardians get a login so they are reachable.
    await sql`
      with s as (
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        select ${inst.institutionId}::uuid, 'BIG-' || g, 'Big ' || g, '2015-01-01', 'other' from generate_series(1, 260) g
        returning id, admission_no
      ), e as (
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
        select ${inst.institutionId}::uuid, id, ${sectionAId}::uuid, ${yearId}::uuid, '2026-04-01', 'active' from s
      ), gd as (
        insert into public.guardians (institution_id, full_name, phone)
        select ${inst.institutionId}::uuid, 'Guardian ' || admission_no, '98' || lpad(substr(admission_no, 5), 8, '0') from s
        returning id, full_name
      )
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      select ${inst.institutionId}::uuid, gd.id, s.id, 'father', true, true from gd join s on gd.full_name = 'Guardian ' || s.admission_no
    `;
    const guardians = await sql`
      select id from public.guardians where institution_id = ${inst.institutionId}::uuid and full_name like 'Guardian BIG-%' order by full_name limit 40
    `;
    const loginIds: string[] = [];
    for (let i = 0; i < guardians.length; i += 10) {
      const batch = await Promise.all(
        guardians.slice(i, i + 10).map(async (g) => {
          const { data, error } = await admin.auth.admin.createUser({
            email: `big-guardian-${crypto.randomUUID()}@test.coolskool.test`,
            password: "correct-horse-battery-staple",
            email_confirm: true,
          });
          if (error || !data.user) throw error ?? new Error("createUser failed");
          await sql`insert into public.memberships (institution_id, user_id, role, guardian_id) values (${inst.institutionId}, ${data.user.id}, 'guardian', ${g.id})`;
          return data.user.id;
        }),
      );
      loginIds.push(...batch);
    }

    const announcementId = await publishAnnouncement(inst, { audience_type: "grade", grade_id: gradeId });
    await notifyAnnouncement(makeJob(inst.institutionId, announcementId), { admin });

    const notified = await sql`
      select recipient_user_id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'announcement'
    `;
    const got = notified.map((n) => n.recipient_user_id as string);
    const expected = [inst.users.student.id, inst.users.guardian.id, guardianBUserId, ...loginIds];
    expect(new Set(got).size).toBe(got.length);
    expect([...got].sort()).toEqual([...expected].sort());
  }, 120_000);

  it("role=teacher audience notifies only teachers", async () => {
    const inst = await createTestInstitution("notif-announce-role");
    createdInstitutions.push(inst);
    const announcementId = await publishAnnouncement(inst, { audience_type: "role", role: "teacher" });

    await notifyAnnouncement(makeJob(inst.institutionId, announcementId), { admin });

    const notified = await sql`
      select recipient_user_id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'announcement'
    `;
    expect(notified.map((n) => n.recipient_user_id)).toEqual([inst.users.teacher.id]);
  });

  it("rerunning the job creates no new notification or delivery attempts", async () => {
    const inst = await createTestInstitution("notif-announce-rerun");
    createdInstitutions.push(inst);
    const announcementId = await publishAnnouncement(inst, { audience_type: "role", role: "teacher" });

    await notifyAnnouncement(makeJob(inst.institutionId, announcementId), { admin });
    const [notification] = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'announcement'
    `;
    const attemptsBefore = await sql`select id from public.delivery_attempts where notification_id = ${notification.id}::uuid`;

    await notifyAnnouncement(makeJob(inst.institutionId, announcementId, "k2"), { admin });

    const notificationsAfter = await sql`
      select id from public.notifications where institution_id = ${inst.institutionId}::uuid and type = 'announcement'
    `;
    expect(notificationsAfter).toHaveLength(1);
    const attemptsAfter = await sql`select id from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    expect(attemptsAfter).toHaveLength(attemptsBefore.length);
  });

  it("a recipient with sms disabled for 'announcement' gets in-app but no sms delivery attempt", async () => {
    const inst = await createTestInstitution("notif-announce-pref");
    createdInstitutions.push(inst);
    await sql`update public.staff set phone = '9833333333' where id = (
      select staff_id from public.memberships where institution_id = ${inst.institutionId}::uuid and user_id = ${inst.users.teacher.id}::uuid
    )`;
    await sql`
      insert into public.notification_preferences (user_id, institution_id, category, channel, enabled)
      values (${inst.users.teacher.id}, ${inst.institutionId}, 'announcement', 'sms', false)
    `;

    const announcementId = await publishAnnouncement(inst, { audience_type: "role", role: "teacher" });
    await notifyAnnouncement(makeJob(inst.institutionId, announcementId), { admin });

    const [notification] = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.teacher.id}::uuid and type = 'announcement'
    `;
    const attempts = await sql`select channel from public.delivery_attempts where notification_id = ${notification.id}::uuid`;
    const channels = attempts.map((a) => a.channel as string);
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("sms");
  });

  it("skips (no-op, no throw) when the announcement is not published", async () => {
    const inst = await createTestInstitution("notif-announce-draft");
    createdInstitutions.push(inst);
    const { data: draft, error } = await inst
      .clientAs("admin")
      .from("announcements")
      .insert({ institution_id: inst.institutionId, title: "Draft only", body: "Not published yet", created_by: inst.users.admin.id })
      .select("id")
      .single();
    if (error || !draft) throw error ?? new Error("draft insert failed");

    await expect(notifyAnnouncement(makeJob(inst.institutionId, draft.id as string), { admin })).resolves.toBeUndefined();

    const notified = await sql`select id from public.notifications where institution_id = ${inst.institutionId}::uuid`;
    expect(notified).toHaveLength(0);
  });
});
