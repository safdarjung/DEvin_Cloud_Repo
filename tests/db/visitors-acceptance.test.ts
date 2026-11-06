// X07-T10 — visitors acceptance over HTTP (X07-tasks.md Task 10). Admin
// checks a visitor in/out via /api/v1/actions + /api/v1/query; guardian
// scoping on pickup persons; class-teacher gate pass create/approve ->
// notify.gate_pass job -> guardian notification; one-open-pass conflict;
// module-disabled gate (own fixture institution, precedent:
// finance-completion-acceptance.test.ts's "MOD's mechanism" direct-settings
// patch, used instead of core.module.set because a never-dispatched slug
// avoids getTenantContext() cache() staleness — same file's own comment).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const { createRunnerPorts, runOnceCore } = await import("@/modules/jobs/runner");
const adminDb = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function adminAuthClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

async function fixtureStaffId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function fixtureStudentId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.student_id as string;
}

async function fixtureGuardianId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.guardian_id as string;
}

async function linkGuardianToStudent(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

/** A second family (G2 + child B), not linked to the fixture guardian — mirrors operations-acceptance.test.ts's addGuardianWithChild. */
async function addGuardianWithChild(inst: TestInstitution, label: string): Promise<{ studentId: string }> {
  const admin = adminAuthClient();
  const email = `second-${label}-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, ${label}, ${randomPhone()})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;
  return { studentId: student.id as string };
}

/** MOD's mechanism (same direct-settings-patch shape as finance-completion-acceptance.test.ts's module-off test). */
async function setModuleEnabledDirect(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}], ${sql.json(enabled)})
    where id = ${institutionId}
  `;
}

describe("X07-T10 visitors acceptance over HTTP", () => {
  it(
    "admin checks a visitor in/out; guardian pickup scoping; class teacher -> gate pass -> approve -> " +
      "notify.gate_pass job -> guardian notification; one-open-pass conflict; guardian pickupList masking",
    async () => {
      const inst = await createTestInstitution("visitors-acceptance");
      try {
        // --- Child A = fixture student, class-taught by the fixture teacher, primary guardian = fixture guardian (G1) ---
        const classTeacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaffId });
        const childAId = await fixtureStudentId(inst.institutionId, "student");
        await createEnrolment(inst.institutionId, childAId, sectionId, yearId);
        const g1GuardianId = await fixtureGuardianId(inst.institutionId, "guardian");
        await linkGuardianToStudent(inst.institutionId, g1GuardianId, childAId);
        // createTestInstitution never runs the invitation-accept flow (0079) that
        // backfills guardians.user_id -> set it here so guardians_select's own-row
        // branch (0020) applies for the embedded guardians(full_name, phone) read
        // in visitorsPickupList (precedent: visitors-queries.test.ts).
        await sql`update public.guardians set user_id = ${inst.users.guardian.id} where id = ${g1GuardianId}`;

        // --- Child B = a second family (G2), unlinked to G1 -------------
        const { studentId: childBId } = await addGuardianWithChild(inst, "visitors-family-b");

        const adminAuth = authHeader((await inst.clientAs("admin").auth.getSession()).data.session!.access_token);
        const teacherAuth = authHeader((await inst.clientAs("teacher").auth.getSession()).data.session!.access_token);
        const g1Auth = authHeader((await inst.clientAs("guardian").auth.getSession()).data.session!.access_token);

        // --- idLast4 too long -> 400 validation_failed -------------------
        const badCheckIn = await dispatchAction(
          "visitors.checkIn",
          {
            institution: inst.slug,
            input: {
              fullName: "Vendor Visitor",
              phone: randomPhone(),
              purpose: "Delivery",
              meetingWith: "Office",
              idType: "aadhaar",
              idLast4: "123456789012",
            },
          },
          adminAuth,
        );
        expect(badCheckIn.status).toBe(422);
        expect((await badCheckIn.json()).error.code).toBe("validation_failed");

        // --- valid check-in -> 200 ----------------------------------------
        const checkInRes = await dispatchAction(
          "visitors.checkIn",
          { institution: inst.slug, input: { fullName: "Vendor Visitor", phone: randomPhone(), purpose: "Delivery", meetingWith: "Office" } },
          adminAuth,
        );
        expect(checkInRes.status).toBe(200);
        const visitorId = (await checkInRes.json()).data.id as string;

        // --- onSite=true shows it ------------------------------------------
        const onSiteRes = await dispatchQuery("visitors.list", inst.slug, { onSite: true }, adminAuth);
        expect(onSiteRes.status).toBe(200);
        const onSiteBody = await onSiteRes.json();
        expect((onSiteBody.data as Array<{ id: string }>).map((r) => r.id)).toContain(visitorId);

        // --- check-out -> 200; gone from onSite ----------------------------
        const checkOutRes = await dispatchAction("visitors.checkOut", { institution: inst.slug, input: { id: visitorId } }, adminAuth);
        expect(checkOutRes.status).toBe(200);

        const onSiteAfter = await dispatchQuery("visitors.list", inst.slug, { onSite: true }, adminAuth);
        const onSiteAfterBody = await onSiteAfter.json();
        expect((onSiteAfterBody.data as Array<{ id: string }>).map((r) => r.id)).not.toContain(visitorId);

        // --- second check-out -> 409 invalid_state -------------------------
        const secondCheckOut = await dispatchAction("visitors.checkOut", { institution: inst.slug, input: { id: visitorId } }, adminAuth);
        expect(secondCheckOut.status).toBe(409);
        expect((await secondCheckOut.json()).error.code).toBe("invalid_state");

        // --- G1 adds a pickup person for own child A -> 200 ----------------
        const pickupAddRes = await dispatchAction(
          "visitors.pickup.add",
          { institution: inst.slug, input: { studentId: childAId, fullName: "Ramesh Sharma", relation: "grandparent", phone: randomPhone() } },
          g1Auth,
        );
        expect(pickupAddRes.status).toBe(200);
        const pickupPersonId = (await pickupAddRes.json()).data.id as string;

        // --- G1 adds a pickup person for B (G2's child) -> 403 forbidden ---
        const pickupDenied = await dispatchAction(
          "visitors.pickup.add",
          { institution: inst.slug, input: { studentId: childBId, fullName: "Someone Else", relation: "other", phone: randomPhone() } },
          g1Auth,
        );
        expect(pickupDenied.status).toBe(403);
        expect((await pickupDenied.json()).error.code).toBe("forbidden");

        // --- class teacher of A's section creates a gate pass with G1's pickup person -> pending ---
        const gatePassRes = await dispatchAction(
          "visitors.gatePass.create",
          { institution: inst.slug, input: { studentId: childAId, reason: "Early dismissal", pickupPersonId } },
          teacherAuth,
        );
        expect(gatePassRes.status).toBe(200);
        const gatePassBody = await gatePassRes.json();
        expect(gatePassBody.data.status).toBe("pending");
        const gatePassId = gatePassBody.data.id as string;

        // --- admin approves -> run the job runner once -> G1 has a gate_pass_approved notification ---
        const approveRes = await dispatchAction(
          "visitors.gatePass.setStatus",
          { institution: inst.slug, input: { id: gatePassId, status: "approved" } },
          adminAuth,
        );
        expect(approveRes.status).toBe(200);

        await runOnceCore({ workerId: "test-worker-visitors-acceptance" }, createRunnerPorts(adminDb));

        const [g1UserId] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
        const [notification] = await sql`
          select id, recipient_user_id from public.notifications
          where institution_id = ${inst.institutionId} and type = 'gate_pass_approved'
        `;
        expect(notification.recipient_user_id).toBe(g1UserId.user_id);

        // --- exit -> 200 -----------------------------------------------------
        const exitRes = await dispatchAction(
          "visitors.gatePass.setStatus",
          { institution: inst.slug, input: { id: gatePassId, status: "exited" } },
          adminAuth,
        );
        expect(exitRes.status).toBe(200);

        // --- a second open pass for A while one is open -> 409 conflict -----
        const openRes = await dispatchAction(
          "visitors.gatePass.create",
          { institution: inst.slug, input: { studentId: childAId, reason: "Dentist", guardianId: g1GuardianId } },
          adminAuth,
        );
        expect(openRes.status).toBe(200);

        const conflictRes = await dispatchAction(
          "visitors.gatePass.create",
          { institution: inst.slug, input: { studentId: childAId, reason: "Another reason", guardianId: g1GuardianId } },
          adminAuth,
        );
        expect(conflictRes.status).toBe(409);
        const conflictBody = await conflictRes.json();
        expect(conflictBody.error.code).toBe("conflict");
        expect(conflictBody.error.fieldErrors?.studentId).toBeDefined();

        // --- G1 pickupList for A -> masked phones; for B -> empty ------------
        const pickupListA = await dispatchQuery("visitors.pickupList", inst.slug, { studentId: childAId }, g1Auth);
        expect(pickupListA.status).toBe(200);
        const pickupListABody = await pickupListA.json();
        const rowsA = pickupListABody.data as Array<{ phoneMasked: string }>;
        expect(rowsA.length).toBeGreaterThan(0);
        for (const row of rowsA) expect(row.phoneMasked).toMatch(/^\*+\d{4}$/);

        const pickupListB = await dispatchQuery("visitors.pickupList", inst.slug, { studentId: childBId }, g1Auth);
        expect(pickupListB.status).toBe(200);
        expect((await pickupListB.json()).data).toEqual([]);
      } finally {
        await inst.cleanup();
      }
    },
  );

  it("module disabled -> visitors.checkIn and visitors.list are forbidden with MODULE_DISABLED_MESSAGE; re-enabling restores access", async () => {
    // A dedicated, never-before-dispatched slug avoids getTenantContext()
    // cache() staleness (finance-completion-acceptance.test.ts's own note).
    const inst = await createTestInstitution("visitors-module-off");
    try {
      await setModuleEnabledDirect(inst.institutionId, "visitors", false);
      const adminAuth = authHeader((await inst.clientAs("admin").auth.getSession()).data.session!.access_token);

      const checkInRes = await dispatchAction(
        "visitors.checkIn",
        { institution: inst.slug, input: { fullName: "Vendor", phone: randomPhone(), purpose: "Delivery", meetingWith: "Office" } },
        adminAuth,
      );
      expect(checkInRes.status).toBe(403);
      const checkInBody = await checkInRes.json();
      expect(checkInBody.error.code).toBe("forbidden");
      const { MODULE_DISABLED_MESSAGE } = await import("@/lib/modules/catalog");
      expect(checkInBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

      const listRes = await dispatchQuery("visitors.list", inst.slug, {}, adminAuth);
      expect(listRes.status).toBe(403);
      expect((await listRes.json()).error.code).toBe("forbidden");

      await setModuleEnabledDirect(inst.institutionId, "visitors", true);
      const reenabledRes = await dispatchAction(
        "visitors.checkIn",
        { institution: inst.slug, input: { fullName: "Vendor", phone: randomPhone(), purpose: "Delivery", meetingWith: "Office" } },
        adminAuth,
      );
      expect(reenabledRes.status).toBe(200);
    } finally {
      await inst.cleanup();
    }
  });
});
