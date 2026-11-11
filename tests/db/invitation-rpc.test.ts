import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeInviteCodesHelper, mintInviteCode } from "../helpers/invite-codes";

// M03-T2 — public.invite_member / accept_invitation / revoke_invitation
// (06 M03 Task 2). Real signed-in clients, same shape as
// tests/db/onboarding-rpc.test.ts. Admin/teacher/guardian memberships that
// aren't the subject of a test are seeded by direct `sql` inserts (the
// `postgres` role trips `guard_membership_write`'s session_user bypass),
// not through the RPCs under test.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function newSignedInUser(label: string) {
  const email = `invitation-rpc-${label}-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  return { userId: data.user.id as string, email, client };
}

async function createInstitution(ownerClient: Awaited<ReturnType<typeof newSignedInUser>>["client"], label: string) {
  const slug = `invite-${label}-${crypto.randomUUID().slice(0, 8)}`;
  // 0127: invite code only (create_institution is no longer granted to `authenticated`).
  const { data, error } = await ownerClient.rpc("create_institution_with_invite", {
    p_code: await mintInviteCode(),
    p_name: `Invite ${label} School`,
    p_slug: slug,
  });
  if (error || !data?.[0]) throw error ?? new Error("institution was not created");
  return data[0].institution_id;
}

async function insertStaff(institutionId: string, employeeNo: string, userId: string | null = null) {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, user_id)
    values (${institutionId}, ${employeeNo}, ${employeeNo}, 'Teacher', ${userId})
    returning id
  `;
  return row.id as string;
}

function randomPhone() {
  return "9" + String(Date.now()).slice(-9);
}

async function insertGuardian(institutionId: string, userId: string | null = null) {
  const [row] = await sql`
    insert into public.guardians (institution_id, full_name, phone, user_id)
    values (${institutionId}, 'Test Guardian', ${randomPhone()}, ${userId})
    returning id
  `;
  return row.id as string;
}

// Bypasses guard_membership_write (session_user = 'postgres') to seed a
// membership directly, without going through the RPCs under test.
async function insertMembershipDirect(
  institutionId: string,
  userId: string,
  role: string,
  staffId: string | null = null,
  guardianId: string | null = null,
) {
  await sql`
    insert into public.memberships (institution_id, user_id, role, status, staff_id, guardian_id)
    values (${institutionId}, ${userId}, ${role}, 'active', ${staffId}, ${guardianId})
  `;
}

function randomToken() {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// Fix round 1 fixture: seeds a second open invitation directly (bypassing
// invite_member's own conflict checks) so two tokens can race onto the same
// (institution, user, role) membership and exercise the unique_violation
// handler in accept_invitation.
async function insertInvitationDirect(institutionId: string, email: string, role: string, staffId: string, token: string) {
  const [{ hash }] = await sql`select encode(extensions.digest(${token}, 'sha256'), 'hex') as hash`;
  await sql`
    insert into public.invitations (institution_id, email, role, staff_id, token_hash, expires_at)
    values (${institutionId}, ${email}, ${role}, ${staffId}, ${hash}, now() + interval '7 days')
  `;
}

async function cleanupInstitutions(institutionIds: string[]) {
  if (institutionIds.length === 0) return;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.allow_reset', 'on', true)`;
    await tx`delete from public.audit_events where institution_id in ${sql(institutionIds)}`;
  });
  await sql`delete from public.invitations where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.memberships where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.guardians where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.staff where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.terms where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.academic_years where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.institutions where id in ${sql(institutionIds)}`;
}

const userIdsToDelete = new Set<string>();
const institutionIdsToDelete = new Set<string>();

afterEach(async () => {
  await cleanupInstitutions([...institutionIdsToDelete]);
  institutionIdsToDelete.clear();
  const admin = adminClient();
  for (const id of userIdsToDelete) {
    await admin.auth.admin.deleteUser(id);
  }
  userIdsToDelete.clear();
});

afterAll(async () => {
  await sql.end();
  await closeInviteCodesHelper();
});

describe("public.invite_member / accept_invitation / revoke_invitation (M03-T2)", () => {
  it("admin invites a teacher linked to a staff row; the teacher accepts and gets an active teacher membership", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner1");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "basic");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin1");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-001", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher1");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-001");

    const { data: inviteData, error: inviteError } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: teacherStaffId,
    });
    expect(inviteError).toBeNull();
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const { data: membershipId, error: acceptError } = await teacherClient.rpc("accept_invitation", { p_token: token });
    expect(acceptError).toBeNull();

    const [membership] = await sql`select role, status, staff_id from public.memberships where id = ${membershipId as string}`;
    expect(membership).toMatchObject({ role: "teacher", status: "active", staff_id: teacherStaffId });

    const [staff] = await sql`select user_id from public.staff where id = ${teacherStaffId}`;
    expect(staff.user_id).toBe(teacherId);
  });

  it("admin cannot invite an owner", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner2");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "noowner");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin2");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-002", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const targetStaffId = await insertStaff(institutionId, "OWN-002");
    const { error } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: "wannabe-owner@test.local",
      p_role: "owner",
      p_staff_id: targetStaffId,
    });
    expect(error?.message).toBe("code:forbidden");
  });

  it("teacher cannot invite", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner3");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "noinvite");
    institutionIdsToDelete.add(institutionId);

    const { userId: teacherId, client: teacherClient } = await newSignedInUser("teacher3");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-003", teacherId);
    await insertMembershipDirect(institutionId, teacherId, "teacher", teacherStaffId);

    const targetStaffId = await insertStaff(institutionId, "TCH-003B");
    const { error } = await teacherClient.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: "someone@test.local",
      p_role: "teacher",
      p_staff_id: targetStaffId,
    });
    expect(error?.message).toBe("code:forbidden");
  });

  it("staff_id from another institution → validation_failed", async () => {
    const { userId: ownerAId, client: ownerAClient } = await newSignedInUser("ownerA");
    userIdsToDelete.add(ownerAId);
    const institutionAId = await createInstitution(ownerAClient, "a");
    institutionIdsToDelete.add(institutionAId);

    const { userId: ownerBId, client: ownerBClient } = await newSignedInUser("ownerB");
    userIdsToDelete.add(ownerBId);
    const institutionBId = await createInstitution(ownerBClient, "b");
    institutionIdsToDelete.add(institutionBId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin4");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionAId, "ADM-004", adminId);
    await insertMembershipDirect(institutionAId, adminId, "admin", adminStaffId);

    const staffInB = await insertStaff(institutionBId, "TCH-B");
    const { error } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionAId,
      p_email: "cross@test.local",
      p_role: "teacher",
      p_staff_id: staffInB,
    });
    expect(error?.message).toBe("code:validation_failed");
  });

  it("wrong email cannot accept", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner5");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "wrongemail");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin5");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-005", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: teacherId, email: teacherEmail } = await newSignedInUser("teacher5");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-005");

    const { data: inviteData } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: teacherStaffId,
    });
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];

    const { userId: strangerId, client: strangerClient } = await newSignedInUser("stranger5");
    userIdsToDelete.add(strangerId);
    const { error } = await strangerClient.rpc("accept_invitation", { p_token: token });
    expect(error?.message).toBe("code:forbidden");
  });

  it("token is single-use", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner6");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "singleuse");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin6");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-006", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher6");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-006");

    const { data: inviteData } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: teacherStaffId,
    });
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];

    const first = await teacherClient.rpc("accept_invitation", { p_token: token });
    expect(first.error).toBeNull();

    const second = await teacherClient.rpc("accept_invitation", { p_token: token });
    expect(second.error?.message).toBe("code:invalid_state");
  });

  it("revoked invitation cannot be accepted", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner7");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "revoked");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin7");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-007", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher7");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-007");

    const { data: inviteData } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: teacherStaffId,
    });
    const [{ invitation_id: invitationId, token }] = inviteData as { invitation_id: string; token: string }[];

    const revoke = await adminClientSignedIn.rpc("revoke_invitation", { p_invitation_id: invitationId });
    expect(revoke.error).toBeNull();

    const { error } = await teacherClient.rpc("accept_invitation", { p_token: token });
    expect(error?.message).toBe("code:invalid_state");
  });

  it("guardian invite links guardians.user_id (DBT-12)", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner8");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "guardian");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin8");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-008", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: guardianUserId, email: guardianEmail, client: guardianClient } = await newSignedInUser("guardian8");
    userIdsToDelete.add(guardianUserId);
    const guardianRowId = await insertGuardian(institutionId);

    const { data: inviteData, error: inviteError } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: guardianEmail,
      p_role: "guardian",
      p_guardian_id: guardianRowId,
    });
    expect(inviteError).toBeNull();
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];

    const { data: membershipId, error: acceptError } = await guardianClient.rpc("accept_invitation", { p_token: token });
    expect(acceptError).toBeNull();

    const [membership] = await sql`select role, status, guardian_id from public.memberships where id = ${membershipId as string}`;
    expect(membership).toMatchObject({ role: "guardian", status: "active", guardian_id: guardianRowId });

    const [guardian] = await sql`select user_id from public.guardians where id = ${guardianRowId}`;
    expect(guardian.user_id).toBe(guardianUserId);
  });

  // Fix round 1, hardening 1: the invitation row is locked (`for update`),
  // so two concurrent accepts of the same token serialise — the second
  // always re-reads an already-accepted row instead of racing the insert.
  it("concurrent accept_invitation calls on the same token serialise (only one membership is created)", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner9");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "lock");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin9");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-009", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher9");
    userIdsToDelete.add(teacherId);
    const teacherStaffId = await insertStaff(institutionId, "TCH-009");

    const { data: inviteData } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: teacherStaffId,
    });
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];

    const [first, second] = await Promise.all([
      teacherClient.rpc("accept_invitation", { p_token: token }),
      teacherClient.rpc("accept_invitation", { p_token: token }),
    ]);
    const results = [first, second];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.message).toBe("code:invalid_state");

    const memberships = await sql`
      select id from public.memberships where institution_id = ${institutionId} and user_id = ${teacherId} and role = 'teacher'
    `;
    expect(memberships).toHaveLength(1);
  });

  // Fix round 1, hardening 2: the linked staff row already belongs to
  // another account → conflict, instead of silently skipping the user_id
  // backfill.
  it("linked record already belonging to another account → conflict", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner10");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "linkconflict");
    institutionIdsToDelete.add(institutionId);

    const { userId: adminId, client: adminClientSignedIn } = await newSignedInUser("admin10");
    userIdsToDelete.add(adminId);
    const adminStaffId = await insertStaff(institutionId, "ADM-010", adminId);
    await insertMembershipDirect(institutionId, adminId, "admin", adminStaffId);

    const { userId: otherUserId } = await newSignedInUser("other10");
    userIdsToDelete.add(otherUserId);
    const staffId = await insertStaff(institutionId, "TCH-010", otherUserId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher10");
    userIdsToDelete.add(teacherId);

    const { data: inviteData, error: inviteError } = await adminClientSignedIn.rpc("invite_member", {
      p_institution_id: institutionId,
      p_email: teacherEmail,
      p_role: "teacher",
      p_staff_id: staffId,
    });
    expect(inviteError).toBeNull();
    const [{ token }] = inviteData as { invitation_id: string; token: string }[];

    const { error } = await teacherClient.rpc("accept_invitation", { p_token: token });
    expect(error?.message).toBe("code:conflict");
  });

  // Fix round 1, hardening 3: a unique_violation on the membership insert
  // (institution_id, user_id, role) maps to code:conflict instead of
  // surfacing as an unmapped internal error.
  it("concurrent accept of two invitations for the same role maps the duplicate to conflict", async () => {
    const { userId: ownerId, client: ownerClient } = await newSignedInUser("owner11");
    userIdsToDelete.add(ownerId);
    const institutionId = await createInstitution(ownerClient, "dupinsert");
    institutionIdsToDelete.add(institutionId);

    const { userId: teacherId, email: teacherEmail, client: teacherClient } = await newSignedInUser("teacher11");
    userIdsToDelete.add(teacherId);
    const staffIdA = await insertStaff(institutionId, "TCH-011A");
    const staffIdB = await insertStaff(institutionId, "TCH-011B");
    const tokenA = randomToken();
    const tokenB = randomToken();
    await insertInvitationDirect(institutionId, teacherEmail, "teacher", staffIdA, tokenA);
    await insertInvitationDirect(institutionId, teacherEmail, "teacher", staffIdB, tokenB);

    const [first, second] = await Promise.all([
      teacherClient.rpc("accept_invitation", { p_token: tokenA }),
      teacherClient.rpc("accept_invitation", { p_token: tokenB }),
    ]);
    const results = [first, second];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.message).toBe("code:conflict");

    const memberships = await sql`
      select id from public.memberships where institution_id = ${institutionId} and user_id = ${teacherId} and role = 'teacher'
    `;
    expect(memberships).toHaveLength(1);
  });
});
