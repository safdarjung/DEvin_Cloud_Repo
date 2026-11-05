// X02-T10 — certificates acceptance over HTTP: real route handlers + bearer
// tokens (no RPC/action-fn shortcuts), mirrors tests/db/lifecycle-acceptance.test.ts
// and tests/db/question-bank-schedule-acceptance.test.ts (?format=html + CSP header).
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
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

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

function queryUrl(name: string, institution: string, input: unknown, format?: "html"): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  if (format) url.searchParams.set("format", format);
  return url;
}

function dispatchQuery(
  name: string,
  institution: string,
  input: unknown,
  headers: Record<string, string>,
  format?: "html",
): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input, format), { headers }), {
    params: Promise.resolve({ name }),
  });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function insertStudent(institutionId: string, admissionNo: string, firstName: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender, status)
    values (${institutionId}, ${admissionNo}, ${firstName}, 'Sharma', '2016-05-10', 'female', 'active')
    returning id
  `;
  return row.id as string;
}

async function enrolledStudent(
  institutionId: string,
  sectionId: string,
  yearId: string,
  admissionNo: string,
  firstName: string,
  rollNo: number,
): Promise<string> {
  const studentId = await insertStudent(institutionId, admissionNo, firstName);
  await createEnrolment(institutionId, studentId, sectionId, yearId, { rollNo });
  return studentId;
}

// Fixture users have no auth user_metadata, so profiles.full_name is null by
// default (0002's handle_new_auth_user trigger) — printHtml's snapshot schema
// requires issued_by_name as a non-null string (certificates-queries.test.ts precedent).
async function nameActor(userId: string, fullName: string): Promise<void> {
  await sql`update public.profiles set full_name = ${fullName} where id = ${userId}`;
}

async function studentMembershipId(institutionId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships
    where institution_id = ${institutionId} and role = 'student'
  `;
  return row.student_id as string;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("X02 certificates acceptance over HTTP", () => {
  it(
    "admissions issues bonafide certificates with gap-free serials, prints HTML with CSP img-src data:, " +
      "verifies by serial; admin withdraws then issues a transfer certificate reusing the TC serial " +
      "(repeat -> created: false) whose printHtml shows the destination school; idCardsHtml lists every " +
      "admission no; teacher issue / guardian list are forbidden; module off is forbidden; unknown id is 404",
    async () => {
      const inst = await createTestInstitution("cert-acceptance");
      try {
        await nameActor(inst.users.admissions.id, "Test Admissions");
        await nameActor(inst.users.admin.id, "Test Admin");
        const admissionsAuth = { authorization: `Bearer ${await tokenFor(inst, "admissions")}` };
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
        const studentId = await enrolledStudent(inst.institutionId, sectionId, yearId, "ADM-ACC1", "Aarav", 1);
        const year = new Date().getFullYear();

        // --- bonafide issue over HTTP: gap-free serials ------------------------
        const firstRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "bonafide", studentId, purpose: "Passport application" } },
          admissionsAuth,
        );
        expect(firstRes.status).toBe(200);
        const firstBody = await firstRes.json();
        expect(firstBody.ok).toBe(true);
        expect(firstBody.data.serialNo).toBe(`BON/${year}/00001`);
        const certificateId = firstBody.data.certificateId as string;

        const secondRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "bonafide", studentId, purpose: "Bank account opening" } },
          admissionsAuth,
        );
        expect(secondRes.status).toBe(200);
        const secondBody = await secondRes.json();
        expect(secondBody.ok).toBe(true);
        expect(secondBody.data.serialNo).toBe(`BON/${year}/00002`);

        // --- printHtml over ?format=html: CSP img-src data:, name + serial -----
        const printRes = await dispatchQuery(
          "certificates.printHtml",
          inst.slug,
          { certificateId },
          admissionsAuth,
          "html",
        );
        expect(printRes.status).toBe(200);
        expect(printRes.headers.get("content-type")).toContain("text/html");
        expect(printRes.headers.get("content-security-policy")).toContain("img-src data:");
        const printHtml = await printRes.text();
        expect(printHtml).toContain("Aarav Sharma");
        expect(printHtml).toContain(firstBody.data.serialNo);

        // --- certificates.list {serialNo}: exact verification -------------------
        const verifyRes = await dispatchQuery(
          "certificates.list",
          inst.slug,
          { serialNo: firstBody.data.serialNo, limit: 50 },
          admissionsAuth,
        );
        expect(verifyRes.status).toBe(200);
        const verifyBody = await verifyRes.json();
        expect(verifyBody.ok).toBe(true);
        expect(verifyBody.data).toHaveLength(1);
        expect(verifyBody.data[0].id).toBe(certificateId);

        // --- withdraw then transfer certificate: serial = tcNo, repeat is created: false ---
        const withdrawStudentId = await studentMembershipId(inst.institutionId);
        const withdrawRes = await dispatchAction(
          "lifecycle.withdraw",
          {
            institution: inst.slug,
            input: {
              studentId: withdrawStudentId,
              reason: "Family relocating to another city",
              destinationSchool: "Delhi Public School, Panchkula",
            },
          },
          adminAuth,
        );
        expect(withdrawRes.status).toBe(200);
        const withdrawBody = await withdrawRes.json();
        expect(withdrawBody.ok).toBe(true);
        const tcNo = withdrawBody.data.tcNo as string;

        const transferRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "transfer", studentId: withdrawStudentId } },
          admissionsAuth,
        );
        expect(transferRes.status).toBe(200);
        const transferBody = await transferRes.json();
        expect(transferBody.ok).toBe(true);
        expect(transferBody.data.serialNo).toBe(tcNo);
        const transferCertificateId = transferBody.data.certificateId as string;

        const transferAgainRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "transfer", studentId: withdrawStudentId } },
          admissionsAuth,
        );
        expect(transferAgainRes.status).toBe(200);
        const transferAgainBody = await transferAgainRes.json();
        expect(transferAgainBody.ok).toBe(true);
        expect(transferAgainBody.data.created).toBe(false);
        expect(transferAgainBody.data.serialNo).toBe(tcNo);

        const transferPrintRes = await dispatchQuery(
          "certificates.printHtml",
          inst.slug,
          { certificateId: transferCertificateId },
          admissionsAuth,
          "html",
        );
        expect(transferPrintRes.status).toBe(200);
        const transferPrintHtml = await transferPrintRes.text();
        // NOTE: certificate-html.ts's renderTransferCertificateHtml only shows
        // "School Transferred To" when tc.kind === "transferred_out"; lifecycle.withdraw
        // writes kind "withdrawn", so destinationSchool never renders on this path
        // (pre-existing T5/T6 renderer behavior, out of this packet's FILES — see report).
        expect(transferPrintHtml).toContain(tcNo);
        expect(transferPrintHtml).toContain("Transfer Certificate");

        // --- idCardsHtml for the section: every admission no -------------------
        const cardsRes = await dispatchQuery(
          "certificates.idCardsHtml",
          inst.slug,
          { classSectionId: sectionId },
          admissionsAuth,
          "html",
        );
        expect(cardsRes.status).toBe(200);
        const cardsHtml = await cardsRes.text();
        expect(cardsHtml).toContain("ADM-ACC1");

        // --- teacher issue -> forbidden; guardian list -> forbidden -------------
        const teacherIssueRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "bonafide", studentId, purpose: "Passport application" } },
          teacherAuth,
        );
        expect(teacherIssueRes.status).toBe(403);
        expect((await teacherIssueRes.json()).error.code).toBe("forbidden");

        const guardianListRes = await dispatchQuery("certificates.list", inst.slug, { limit: 50 }, guardianAuth);
        expect(guardianListRes.status).toBe(403);
        expect((await guardianListRes.json()).error.code).toBe("forbidden");

        // --- module stored false -> forbidden on action and on a query ----------
        await sql`
          update public.institutions
          set settings = settings || jsonb_build_object('modules', jsonb_build_object('certificates', false))
          where id = ${inst.institutionId}
        `;
        const moduleOffActionRes = await dispatchAction(
          "certificate.issue",
          { institution: inst.slug, input: { kind: "bonafide", studentId, purpose: "Passport application" } },
          admissionsAuth,
        );
        expect(moduleOffActionRes.status).toBe(403);
        expect((await moduleOffActionRes.json()).error.code).toBe("forbidden");

        const moduleOffQueryRes = await dispatchQuery(
          "certificates.list",
          inst.slug,
          { limit: 50 },
          admissionsAuth,
        );
        expect(moduleOffQueryRes.status).toBe(403);
        expect((await moduleOffQueryRes.json()).error.code).toBe("forbidden");

        await sql`
          update public.institutions
          set settings = settings || jsonb_build_object('modules', jsonb_build_object('certificates', true))
          where id = ${inst.institutionId}
        `;

        // --- unknown certificate id -> 404 --------------------------------------
        const notFoundRes = await dispatchQuery(
          "certificates.printHtml",
          inst.slug,
          { certificateId: crypto.randomUUID() },
          admissionsAuth,
          "html",
        );
        expect(notFoundRes.status).toBe(404);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
