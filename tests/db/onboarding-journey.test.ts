// M03-T11 — M3 acceptance: a brand-new school onboarded end-to-end using
// only the HTTP API (real exported route handlers + bearer tokens), no
// direct SQL/RPC shortcuts for anything the API itself exposes. Mirrors
// api-institutions-route.test.ts (new-user sign-up + create_institution)
// and api-invitation-accept-route.test.ts (invite -> accept) fixtures and
// cleanup; adds the academics/people setup actions (M03-T9/T10) and the
// query dispatcher (M02) to complete the journey.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as createInstitution } from "@/app/api/v1/institutions/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/accept/route";
import { POST as dispatchAction } from "@/app/api/v1/actions/[name]/route";
import { GET as dispatchQueryGet } from "@/app/api/v1/query/[name]/route";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function newSignedInUser(label: string, email?: string) {
  const userEmail = email ?? `onboarding-journey-${label}-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email: userEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email: userEmail,
    password: PASSWORD,
  });
  if (signInError || !signIn.session) throw signInError ?? new Error("sign-in produced no session");

  return { userId: data.user.id, email: userEmail, token: signIn.session.access_token };
}

// Same immutable-history-aware cleanup shape as api-institutions-route.test.ts,
// extended for the setup rows this journey creates. Children before parents:
// audit -> invitations -> subject_assignments -> class_sections -> grades/
// subjects -> memberships -> staff -> departments -> terms/academic_years ->
// institution.
async function cleanupInstitution(institutionId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.allow_reset', 'on', true)`;
    await tx`delete from public.audit_events where institution_id = ${institutionId}`;
  });
  await sql`delete from public.invitations where institution_id = ${institutionId}`;
  await sql`delete from public.subject_assignments where institution_id = ${institutionId}`;
  await sql`delete from public.class_sections where institution_id = ${institutionId}`;
  await sql`delete from public.grades where institution_id = ${institutionId}`;
  await sql`delete from public.subjects where institution_id = ${institutionId}`;
  await sql`delete from public.memberships where institution_id = ${institutionId}`;
  await sql`delete from public.staff where institution_id = ${institutionId}`;
  await sql`delete from public.departments where institution_id = ${institutionId}`;
  await sql`delete from public.terms where institution_id = ${institutionId}`;
  await sql`delete from public.academic_years where institution_id = ${institutionId}`;
  await sql`delete from public.institutions where id = ${institutionId}`;
}

afterAll(async () => {
  await sql.end();
});

function actionRequest(name: string, slug: string, input: unknown, token: string): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ institution: slug, input }),
  });
}

async function callAction(name: string, slug: string, input: unknown, token: string) {
  const res = await dispatchAction(actionRequest(name, slug, input, token), {
    params: Promise.resolve({ name }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function callQuery(name: string, slug: string, input: unknown, token: string) {
  const url = `http://localhost/api/v1/query/${name}?institution=${slug}&input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await dispatchQueryGet(new Request(url, { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ name }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

describe("onboarding journey over HTTP (M03-T11)", () => {
  it("owner stands up a school, invites a teacher, teacher works and is then disabled", async () => {
    const createdUserIds: string[] = [];
    let institutionId: string | undefined;

    try {
      // 1. Brand-new user -> POST /api/v1/institutions.
      const owner = await newSignedInUser("owner");
      createdUserIds.push(owner.userId);
      const slug = `onboarding-journey-${crypto.randomUUID().slice(0, 8)}`;

      const createRes = await createInstitution(
        new Request("http://localhost/api/v1/institutions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${owner.token}` },
          body: JSON.stringify({ input: { name: "Onboarding Journey School", slug } }),
        }),
      );
      expect(createRes.status).toBe(200);
      const createBody = await createRes.json();
      expect(createBody.ok).toBe(true);
      institutionId = createBody.data.institutionId as string;

      // 2. Owner builds the academic structure via /api/v1/actions/*.
      const dept = await callAction("people.department.upsert", slug, { name: "Science" }, owner.token);
      expect(dept.status).toBe(200);
      const departmentId = dept.body.data.id as string;

      const teacherStaff = await callAction(
        "people.staff.upsert",
        slug,
        {
          employeeNo: `EMP-${crypto.randomUUID().slice(0, 8)}`,
          fullName: "Teaching Staff",
          designation: "Teacher",
          departmentId,
          isTeaching: true,
        },
        owner.token,
      );
      expect(teacherStaff.status).toBe(200);
      const teacherStaffId = teacherStaff.body.data.id as string;

      const grade = await callAction(
        "academics.grade.upsert",
        slug,
        { code: `G-${crypto.randomUUID().slice(0, 6)}`, displayName: "Grade VI", sortKey: 6, gradeGroup: "middle" },
        owner.token,
      );
      expect(grade.status).toBe(200);
      const gradeId = grade.body.data.id as string;

      const academicYear = await callAction(
        "core.academicYear.upsert",
        slug,
        { name: `AY-${crypto.randomUUID().slice(0, 8)}`, startsOn: "2026-04-01", endsOn: "2027-03-31" },
        owner.token,
      );
      expect(academicYear.status).toBe(200);
      const academicYearId = academicYear.body.data.id as string;

      const section = await callAction(
        "academics.section.upsert",
        slug,
        { gradeId, academicYearId, name: "A" },
        owner.token,
      );
      expect(section.status).toBe(200);
      const sectionId = section.body.data.id as string;

      const subject = await callAction(
        "academics.subject.upsert",
        slug,
        { code: `SUB-${crypto.randomUUID().slice(0, 6)}`, name: "Science", kind: "scholastic" },
        owner.token,
      );
      expect(subject.status).toBe(200);
      const subjectId = subject.body.data.id as string;

      const assignment = await callAction(
        "academics.subjectAssignment.set",
        slug,
        { classSectionId: sectionId, subjectId, teacherId: teacherStaffId },
        owner.token,
      );
      expect(assignment.status).toBe(200);

      // 3. Owner invites the teacher (by staffId) -> teacher signs in -> accepts.
      const teacher = await newSignedInUser("teacher");
      createdUserIds.push(teacher.userId);
      const teacherInvite = await callAction(
        "core.member.invite",
        slug,
        { email: teacher.email, role: "teacher", staffId: teacherStaffId },
        owner.token,
      );
      expect(teacherInvite.status).toBe(200);
      const teacherInviteToken = teacherInvite.body.data.token as string;

      const acceptRes = await acceptInvitation(
        new Request("http://localhost/api/v1/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${teacher.token}` },
          body: JSON.stringify({ input: { token: teacherInviteToken } }),
        }),
      );
      expect(acceptRes.status).toBe(200);
      const acceptBody = await acceptRes.json();
      expect(acceptBody.ok).toBe(true);
      const teacherMembershipId = acceptBody.data.membershipId as string;

      // 4. Teacher reads the section they now teach.
      const sections = await callQuery("academics.listTeachableSections", slug, {}, teacher.token);
      expect(sections.status).toBe(200);
      expect(sections.body.ok).toBe(true);
      expect((sections.body.data as Array<{ id: string }>).some((s) => s.id === sectionId)).toBe(true);

      // 5. Escalation: teacher cannot invite members (no member.manage permission).
      const teacherInvites = await callAction(
        "core.member.invite",
        slug,
        { email: `onboarding-journey-blocked-${crypto.randomUUID()}@test.local`, role: "teacher" },
        teacher.token,
      );
      expect(teacherInvites.status).toBe(403);
      expect(teacherInvites.body.error.code).toBe("forbidden");

      // 6. Escalation: an admin cannot invite an owner (invite_member's own
      // role-escalation check, 0079).
      const adminStaff = await callAction(
        "people.staff.upsert",
        slug,
        { employeeNo: `EMP-${crypto.randomUUID().slice(0, 8)}`, fullName: "Admin Staff", designation: "Admin" },
        owner.token,
      );
      expect(adminStaff.status).toBe(200);
      const adminStaffId = adminStaff.body.data.id as string;

      const admin = await newSignedInUser("admin");
      createdUserIds.push(admin.userId);
      const adminInvite = await callAction(
        "core.member.invite",
        slug,
        { email: admin.email, role: "admin", staffId: adminStaffId },
        owner.token,
      );
      expect(adminInvite.status).toBe(200);
      const adminInviteToken = adminInvite.body.data.token as string;

      const adminAcceptRes = await acceptInvitation(
        new Request("http://localhost/api/v1/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${admin.token}` },
          body: JSON.stringify({ input: { token: adminInviteToken } }),
        }),
      );
      expect(adminAcceptRes.status).toBe(200);

      const adminInvitesOwner = await callAction(
        "core.member.invite",
        slug,
        { email: `onboarding-journey-owner2-${crypto.randomUUID()}@test.local`, role: "owner" },
        admin.token,
      );
      expect(adminInvitesOwner.status).toBe(403);
      expect(adminInvitesOwner.body.error.code).toBe("forbidden");

      // 7. Owner disables the teacher's membership; teacher is then a stranger.
      const disable = await callAction(
        "core.member.setStatus",
        slug,
        { membershipId: teacherMembershipId, status: "disabled" },
        owner.token,
      );
      expect(disable.status).toBe(200);

      const sectionsAfterDisable = await callQuery("academics.listTeachableSections", slug, {}, teacher.token);
      expect(sectionsAfterDisable.status).toBe(404);
    } finally {
      if (institutionId) await cleanupInstitution(institutionId);
      const admin = adminClient();
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }
  });
});
