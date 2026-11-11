// M05-T5 — documents acceptance: HTTP actions (real bearer tokens, real
// RLS) + storage-level checks on the `tenant-docs` bucket. Mirrors
// imports-acceptance.test.ts / api-actions-route.test.ts: @/lib/supabase/server
// is NOT mocked. One fixture school: admin uploads a PDF for student A and
// a PNG for staff member T (the fixture teacher); guardian A (fixture
// guardian, linked to A) reads A's PDF; a second guardian (B, linked only
// to a second student B created for this test) must not read A's doc;
// teacher T reads their own staff doc, not A's; direct storage calls
// bypassing the action layer are checked against the bucket's own RLS and
// its file-size/mime limits.
import { createClient } from "@supabase/supabase-js";
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
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const BUCKET = "tenant-docs";
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
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

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("M05 documents acceptance (HTTP actions + storage)", () => {
  it(
    "guardian reads own child's doc, not another child's; teacher reads own staff doc, not a student's; " +
      "storage refuses a direct bypass and refuses an oversized/wrong-mime object even with a valid signed token",
    async () => {
      const inst = await createTestInstitution("documents-acceptance");
      const admin = adminClient();
      const storagePaths: string[] = [];
      let guardianBUserId: string | null = null;

      try {
        const [{ guardian_id: guardianAId }] = await sql<{ guardian_id: string }[]>`
          select guardian_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
        `;
        const [{ student_id: studentAId }] = await sql<{ student_id: string }[]>`
          select student_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
        `;
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
          values (${inst.institutionId}, ${guardianAId}, ${studentAId}, 'father', true)
        `;

        const [{ staff_id: teacherStaffId }] = await sql<{ staff_id: string }[]>`
          select staff_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
        `;
        await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${teacherStaffId}`;

        // Second child + second guardian, not linked to A — proves guardian
        // scoping, not just tenant scoping.
        const [studentB] = await sql<{ id: string }[]>`
          insert into public.students (institution_id, admission_no, first_name, dob, gender)
          values (${inst.institutionId}, ${`ADM-B-${crypto.randomUUID().slice(0, 8)}`}, 'StudentB', '2015-01-01', 'other')
          returning id
        `;
        const studentBId = studentB.id;

        const guardianBEmail = `test-documents-acceptance-guardianB-${crypto.randomUUID()}@test.coolskool.test`;
        const { data: guardianBAuthData, error: guardianBAuthError } = await admin.auth.admin.createUser({
          email: guardianBEmail,
          password: PASSWORD,
          email_confirm: true,
        });
        if (guardianBAuthError || !guardianBAuthData.user) {
          throw guardianBAuthError ?? new Error("failed to create guardian B test user");
        }
        guardianBUserId = guardianBAuthData.user.id;

        const [guardianBRow] = await sql<{ id: string }[]>`
          insert into public.guardians (institution_id, full_name, phone)
          values (${inst.institutionId}, 'Test Guardian B', ${randomPhone()})
          returning id
        `;
        await sql`
          insert into public.memberships (institution_id, user_id, role, guardian_id)
          values (${inst.institutionId}, ${guardianBUserId}, 'guardian', ${guardianBRow.id})
        `;
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
          values (${inst.institutionId}, ${guardianBRow.id}, ${studentBId}, 'mother', true)
        `;

        const guardianBClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL as string,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
        );
        const { error: guardianBSignInError } = await guardianBClient.auth.signInWithPassword({
          email: guardianBEmail,
          password: PASSWORD,
        });
        if (guardianBSignInError) throw guardianBSignInError;
        const { data: guardianBSession, error: guardianBSessionError } = await guardianBClient.auth.getSession();
        if (guardianBSessionError || !guardianBSession.session) {
          throw guardianBSessionError ?? new Error("no session for guardian B");
        }

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const guardianAAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const guardianBAuth = { authorization: `Bearer ${guardianBSession.session.access_token}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- admin uploads a PDF for student A ---------------------------
        const pdfBytes = Buffer.from("fake-pdf-bytes-for-student-a");
        const reqA = await dispatchAction(
          "document.requestUpload",
          {
            institution: inst.slug,
            input: {
              entityType: "student",
              entityId: studentAId,
              kind: "id_proof",
              fileName: "a.pdf",
              mime: "application/pdf",
              sizeBytes: pdfBytes.length,
            },
          },
          adminAuth,
        );
        expect(reqA.status).toBe(200);
        const reqABody = await reqA.json();
        expect(reqABody.ok).toBe(true);
        const { documentId: docAId, path: pathA, token: tokenA } = reqABody.data;
        storagePaths.push(pathA);

        const uploadA = await inst
          .clientAs("admin")
          .storage.from(BUCKET)
          .uploadToSignedUrl(pathA, tokenA, pdfBytes, { contentType: "application/pdf" });
        expect(uploadA.error).toBeNull();

        const confirmA = await dispatchAction(
          "document.confirmUpload",
          { institution: inst.slug, input: { documentId: docAId } },
          adminAuth,
        );
        const confirmABody = await confirmA.json();
        expect(confirmA.status).toBe(200);
        expect(confirmABody.ok).toBe(true);

        // --- admin uploads a PNG for staff member T (the teacher) --------
        const pngBytes = Buffer.from("fake-png-bytes-for-teacher-t");
        const reqT = await dispatchAction(
          "document.requestUpload",
          {
            institution: inst.slug,
            input: {
              entityType: "staff",
              entityId: teacherStaffId,
              kind: "id_proof",
              fileName: "t.png",
              mime: "image/png",
              sizeBytes: pngBytes.length,
            },
          },
          adminAuth,
        );
        expect(reqT.status).toBe(200);
        const reqTBody = await reqT.json();
        expect(reqTBody.ok).toBe(true);
        const { documentId: docTId, path: pathT, token: tokenT } = reqTBody.data;
        storagePaths.push(pathT);

        const uploadT = await inst
          .clientAs("admin")
          .storage.from(BUCKET)
          .uploadToSignedUrl(pathT, tokenT, pngBytes, { contentType: "image/png" });
        expect(uploadT.error).toBeNull();

        const confirmT = await dispatchAction(
          "document.confirmUpload",
          { institution: inst.slug, input: { documentId: docTId } },
          adminAuth,
        );
        expect(confirmT.status).toBe(200);
        expect((await confirmT.json()).ok).toBe(true);

        // --- guardian of A reads A's PDF; bytes match ---------------------
        const readA = await dispatchAction(
          "document.getReadUrl",
          { institution: inst.slug, input: { documentId: docAId } },
          guardianAAuth,
        );
        expect(readA.status).toBe(200);
        const readABody = await readA.json();
        expect(readABody.ok).toBe(true);
        expect(readABody.data.fileName).toBe("a.pdf");
        expect(readABody.data.mime).toBe("application/pdf");
        const fetchedA = await fetch(readABody.data.url);
        expect(fetchedA.status).toBe(200);
        expect(Buffer.from(await fetchedA.arrayBuffer()).equals(pdfBytes)).toBe(true);

        // --- guardian of B cannot read A's doc ----------------------------
        const readAAsGuardianB = await dispatchAction(
          "document.getReadUrl",
          { institution: inst.slug, input: { documentId: docAId } },
          guardianBAuth,
        );
        expect(readAAsGuardianB.status).toBe(404);
        expect((await readAAsGuardianB.json()).error.code).toBe("not_found");

        // --- teacher T reads own staff doc, not A's -----------------------
        const readT = await dispatchAction(
          "document.getReadUrl",
          { institution: inst.slug, input: { documentId: docTId } },
          teacherAuth,
        );
        expect(readT.status).toBe(200);
        const readTBody = await readT.json();
        expect(readTBody.ok).toBe(true);
        const fetchedT = await fetch(readTBody.data.url);
        expect(fetchedT.status).toBe(200);
        expect(Buffer.from(await fetchedT.arrayBuffer()).equals(pngBytes)).toBe(true);

        const readAAsTeacher = await dispatchAction(
          "document.getReadUrl",
          { institution: inst.slug, input: { documentId: docAId } },
          teacherAuth,
        );
        expect(readAAsTeacher.status).toBe(404);
        expect((await readAAsTeacher.json()).error.code).toBe("not_found");

        // --- direct storage calls with guardian A's own client -----------
        const pathOfB = `${inst.institutionId}/student/${studentBId}/doc.pdf`;
        const directDownloadB = await inst.clientAs("guardian").storage.from(BUCKET).download(pathOfB);
        expect(directDownloadB.error).not.toBeNull();

        const bypassPath = `${inst.institutionId}/student/${studentAId}/direct-bypass.pdf`;
        const directUpload = await inst
          .clientAs("guardian")
          .storage.from(BUCKET)
          .upload(bypassPath, Buffer.from("no-pending-row-for-this-path"), { contentType: "application/pdf" });
        expect(directUpload.error).not.toBeNull();

        // --- bucket enforces its own size/mime limits even given a valid
        //     signed upload token for a declared-small, declared-pdf file ---
        const reqOversize = await dispatchAction(
          "document.requestUpload",
          {
            institution: inst.slug,
            input: {
              entityType: "student",
              entityId: studentAId,
              kind: "id_proof",
              fileName: "big.pdf",
              mime: "application/pdf",
              sizeBytes: 1000,
            },
          },
          adminAuth,
        );
        expect(reqOversize.status).toBe(200);
        const reqOversizeBody = await reqOversize.json();
        storagePaths.push(reqOversizeBody.data.path);
        const oversizeBytes = Buffer.alloc(11 * 1024 * 1024, 1);
        const oversizeUpload = await inst
          .clientAs("admin")
          .storage.from(BUCKET)
          .uploadToSignedUrl(reqOversizeBody.data.path, reqOversizeBody.data.token, oversizeBytes, {
            contentType: "application/pdf",
          });
        // 0142: the bucket takes up to 50 MB (textbook PDFs), so an 11 MB object may be stored,
        // but app.guard_document_object_size keeps a student document from going live with it.
        if (oversizeUpload.error === null) {
          const confirmOversize = await dispatchAction(
            "document.confirmUpload",
            { institution: inst.slug, input: { documentId: reqOversizeBody.data.documentId } },
            adminAuth,
          );
          expect((await confirmOversize.json()).ok).toBe(false);
          const [{ status: oversizeStatus }] = await sql`select status from public.documents where id = ${reqOversizeBody.data.documentId}`;
          expect(oversizeStatus).toBe("pending");
        }

        const reqBadMime = await dispatchAction(
          "document.requestUpload",
          {
            institution: inst.slug,
            input: {
              entityType: "student",
              entityId: studentAId,
              kind: "id_proof",
              fileName: "evil.pdf",
              mime: "application/pdf",
              sizeBytes: 1000,
            },
          },
          adminAuth,
        );
        expect(reqBadMime.status).toBe(200);
        const reqBadMimeBody = await reqBadMime.json();
        storagePaths.push(reqBadMimeBody.data.path);
        const badMimeUpload = await inst
          .clientAs("admin")
          .storage.from(BUCKET)
          .uploadToSignedUrl(reqBadMimeBody.data.path, reqBadMimeBody.data.token, Buffer.from("MZ-fake-exe-bytes"), {
            contentType: "application/x-msdownload",
          });
        expect(badMimeUpload.error).not.toBeNull();
      } finally {
        if (storagePaths.length) await admin.storage.from(BUCKET).remove(storagePaths);
        if (guardianBUserId) await admin.auth.admin.deleteUser(guardianBUserId);
        await inst.cleanup();
      }
    },
  );
});
