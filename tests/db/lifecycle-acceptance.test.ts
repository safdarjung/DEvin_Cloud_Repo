// M14-T9 — lifecycle acceptance over HTTP: admin promotes one mapped
// section (counts, idempotent re-run), reads lifecycle.history for the
// promoted student (completed + active rows); admin withdraws a student
// with a portal login — their only-child guardian loses portal access
// (404), a guardian with an active sibling keeps it (200) and still reads
// the TC via lifecycle.history; a teacher is forbidden from withdrawing.
// Mirrors timetable-acceptance.test.ts's real route handlers + bearer
// tokens (no RPC/action-fn shortcuts for anything the HTTP API exposes).
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

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

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

async function tokenFor(inst: TestInstitution, role: "admin" | "teacher" | "student" | "guardian"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** A second guardian not in the fixture's one-per-role roster, with a real session for a bearer token. */
async function newGuardian(institutionId: string, fullName: string): Promise<{ guardianId: string; userId: string; token: string }> {
  const email = `lc-acceptance-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, ${fullName}, ${`9${String(Math.floor(100000000 + Math.random() * 900000000))}`})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError || !signIn.session) throw signInError ?? new Error("sign-in produced no session");

  return { guardianId: guardian.id as string, userId: data.user.id, token: signIn.session.access_token };
}

async function insertPlainStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string, isPrimary: boolean) {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', ${isPrimary})
  `;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M14 lifecycle acceptance: promote + withdraw over HTTP", () => {
  it(
    "admin promotes one mapped section (idempotent re-run) and reads lifecycle.history for the promoted student; " +
      "admin withdraws a portal-login student — only-child guardian loses access (404), guardian with an active " +
      "sibling keeps it (200) and reads the TC via lifecycle.history; teacher withdraw is forbidden",
    async () => {
      const inst = await createTestInstitution("lc-acceptance");
      let extraGuardianUserId: string | null = null;
      try {
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- Promote: one mapped section, admin over HTTP --------------------
        const fromYearId = await createAcademicYear(inst.institutionId, {
          name: "2026-27",
          startsOn: "2026-04-01",
          endsOn: "2027-03-31",
          isCurrent: false,
        });
        const toYearId = await createAcademicYear(inst.institutionId, {
          name: "2027-28",
          startsOn: "2027-04-01",
          endsOn: "2028-03-31",
          isCurrent: true,
        });
        const gradeId = await createGrade(inst.institutionId);
        const sectionFrom = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
        const sectionTo = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
        const promotedStudentId = await insertPlainStudent(inst.institutionId, `ADM-PROM-${crypto.randomUUID().slice(0, 6)}`);
        await createEnrolment(inst.institutionId, promotedStudentId, sectionFrom, fromYearId, { rollNo: 1 });

        const promoteInput = {
          institution: inst.slug,
          input: { fromYearId, toYearId, mappings: [{ fromSectionId: sectionFrom, toSectionId: sectionTo }] },
        };
        const promoteRes = await dispatchAction("lifecycle.promote", promoteInput, adminAuth);
        expect(promoteRes.status).toBe(200);
        const promoteBody = await promoteRes.json();
        expect(promoteBody.ok).toBe(true);
        expect(promoteBody.data.promoted).toBe(1);
        expect(promoteBody.data.graduated).toBe(0);
        expect(promoteBody.data.skippedStudentIds).toEqual([]);

        // Same request again -> zeros (completed rows are never candidates again).
        const promoteAgainRes = await dispatchAction("lifecycle.promote", promoteInput, adminAuth);
        expect(promoteAgainRes.status).toBe(200);
        const promoteAgainBody = await promoteAgainRes.json();
        expect(promoteAgainBody.ok).toBe(true);
        expect(promoteAgainBody.data.promoted).toBe(0);
        expect(promoteAgainBody.data.graduated).toBe(0);
        expect(promoteAgainBody.data.skippedStudentIds).toEqual([]);

        // lifecycle.history -> both the completed (from-year) and active (to-year) rows.
        const historyRes = await dispatchQuery("lifecycle.history", inst.slug, { studentId: promotedStudentId }, adminAuth);
        expect(historyRes.status).toBe(200);
        const historyBody = await historyRes.json();
        expect(historyBody.ok).toBe(true);
        expect(historyBody.data.enrolments).toHaveLength(2);
        const statuses = historyBody.data.enrolments.map((e: { status: string }) => e.status).sort();
        expect(statuses).toEqual(["active", "completed"]);

        // --- Withdraw: portal-login student, two guardians --------------------
        const [studentMembership] = await sql`
          select user_id, student_id from public.memberships
          where institution_id = ${inst.institutionId} and role = 'student'
        `;
        const withdrawnStudentId = studentMembership.student_id as string;

        const [guardianMembership] = await sql`
          select guardian_id from public.memberships
          where institution_id = ${inst.institutionId} and role = 'guardian'
        `;
        const onlyChildGuardianId = guardianMembership.guardian_id as string;
        await linkGuardian(inst.institutionId, onlyChildGuardianId, withdrawnStudentId, true);

        const siblingId = await insertPlainStudent(inst.institutionId, `ADM-SIB-${crypto.randomUUID().slice(0, 6)}`);
        const siblingGuardian = await newGuardian(inst.institutionId, "Sibling Guardian");
        extraGuardianUserId = siblingGuardian.userId;
        await linkGuardian(inst.institutionId, siblingGuardian.guardianId, withdrawnStudentId, false);
        await linkGuardian(inst.institutionId, siblingGuardian.guardianId, siblingId, false);

        const withdrawRes = await dispatchAction(
          "lifecycle.withdraw",
          { institution: inst.slug, input: { studentId: withdrawnStudentId, reason: "Family relocating to another city" } },
          adminAuth,
        );
        expect(withdrawRes.status).toBe(200);
        const withdrawBody = await withdrawRes.json();
        expect(withdrawBody.ok).toBe(true);
        const tcNo = withdrawBody.data.tcNo as string;
        expect(tcNo).toMatch(/^TC\/\d{4}\/\d{5}$/);

        // The withdrawn student's own token: no active membership -> 404.
        const studentAuth = { authorization: `Bearer ${await tokenFor(inst, "student")}` };
        const selfRes = await dispatchQuery("people.getMyStudent", inst.slug, {}, studentAuth);
        expect(selfRes.status).toBe(404);

        // Only-child guardian: no other active linked student -> membership disabled -> 404.
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const guardianRes = await dispatchQuery("people.listMyChildren", inst.slug, {}, guardianAuth);
        expect(guardianRes.status).toBe(404);

        // Guardian with an active sibling: membership stays active -> 200, still reads the TC.
        const siblingGuardianAuth = { authorization: `Bearer ${siblingGuardian.token}` };
        const siblingHistoryRes = await dispatchQuery(
          "lifecycle.history",
          inst.slug,
          { studentId: withdrawnStudentId },
          siblingGuardianAuth,
        );
        expect(siblingHistoryRes.status).toBe(200);
        const siblingHistoryBody = await siblingHistoryRes.json();
        expect(siblingHistoryBody.ok).toBe(true);
        const withdrawEvent = siblingHistoryBody.data.events.find((e: { kind: string }) => e.kind === "withdrawn");
        expect(withdrawEvent?.tcNo).toBe(tcNo);

        // Teacher withdraw -> forbidden.
        const teacherWithdrawRes = await dispatchAction(
          "lifecycle.withdraw",
          { institution: inst.slug, input: { studentId: withdrawnStudentId, reason: "Family relocating to another city" } },
          teacherAuth,
        );
        expect(teacherWithdrawRes.status).toBe(403);
        const teacherWithdrawBody = await teacherWithdrawRes.json();
        expect(teacherWithdrawBody.ok).toBe(false);
        expect(teacherWithdrawBody.error.code).toBe("forbidden");
      } finally {
        if (extraGuardianUserId) await adminClient().auth.admin.deleteUser(extraGuardianUserId);
        await inst.cleanup();
      }
    },
  );
});
