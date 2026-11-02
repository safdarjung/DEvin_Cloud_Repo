// M09-T7 — submissions acceptance over HTTP: teacher creates + publishes an
// assignment with a past dueAt, student submits (late) then resubmits,
// attaches a document, teacher grades over the query/action HTTP routes;
// accountant forbidden to grade; resubmit after grading is 409; guardian
// sees feedback for own child, not for another family's. Mirrors
// timetable-acceptance.test.ts's HTTP dispatch pattern.
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
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

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

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(
  inst: TestInstitution,
  role: "teacher" | "student" | "guardian" | "accountant",
): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function studentMembershipId(institutionId: string, userId: string): Promise<string> {
  const [row] = await sql`
    select student_id as id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return row.id as string;
}

async function guardianMembershipId(institutionId: string, userId: string): Promise<string> {
  const [row] = await sql`
    select guardian_id as id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return row.id as string;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M09 submissions acceptance: submit/resubmit, attach doc, grade, 403/409 paths, guardian feedback", () => {
  it(
    "teacher creates+publishes a past-due assignment; student submits late, resubmits, attaches a document; " +
      "teacher roster shows it with documentCount 1; teacher grades; accountant grade is 403; " +
      "resubmit after grading is 409; guardian sees own child's feedback, not another family's",
    async () => {
      const inst = await createTestInstitution("submissions-acceptance");
      try {
        // --- Fixtures: section, subject, teacher-in-scope, enrolled student, guardian link ---
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
        const subjectId = await createSubject(inst.institutionId);
        const staffId = await teacherStaffId(inst.institutionId);
        await createSubjectAssignment(inst.institutionId, sectionId, subjectId, staffId);

        const studentId = await studentMembershipId(inst.institutionId, inst.users.student.id);
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

        const guardianId = await guardianMembershipId(inst.institutionId, inst.users.guardian.id);
        await sql`
          insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
          values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
        `;

        // Second family's child, enrolled in the same section, no guardian link.
        const [otherStudent] = await sql`
          insert into public.students (institution_id, admission_no, first_name, dob, gender)
          values (${inst.institutionId}, ${`ADM-OTH-${crypto.randomUUID().slice(0, 6)}`}, 'Other', '2015-01-01', 'other')
          returning id
        `;
        const otherStudentId = otherStudent.id as string;
        await createEnrolment(inst.institutionId, otherStudentId, sectionId, yearId);

        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const studentAuth = { authorization: `Bearer ${await tokenFor(inst, "student")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const accountantAuth = { authorization: `Bearer ${await tokenFor(inst, "accountant")}` };

        // --- Teacher creates a published-with-past-due-date assignment -------
        const pastDueAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const createRes = await dispatchAction(
          "assignment.create",
          {
            institution: inst.slug,
            input: { classSectionId: sectionId, subjectId, title: "Late Worksheet", dueAt: pastDueAt },
          },
          teacherAuth,
        );
        expect(createRes.status).toBe(200);
        const createBody = await createRes.json();
        expect(createBody.ok).toBe(true);
        const assignmentId = createBody.data.id as string;

        const publishRes = await dispatchAction(
          "assignment.publish",
          { institution: inst.slug, input: { assignmentId } },
          teacherAuth,
        );
        expect(publishRes.status).toBe(200);
        const publishBody = await publishRes.json();
        expect(publishBody.ok).toBe(true);

        // --- Student submits -> late ------------------------------------------
        const submitRes = await dispatchAction(
          "assignment.submit",
          { institution: inst.slug, input: { assignmentId, text: "first answer" } },
          studentAuth,
        );
        expect(submitRes.status).toBe(200);
        const submitBody = await submitRes.json();
        expect(submitBody.ok).toBe(true);
        expect(submitBody.data.isLate).toBe(true);
        expect(submitBody.data.attempt).toBe(1);
        const submissionId = submitBody.data.submissionId as string;

        // --- Student resubmits -> attempt 2, same row -------------------------
        const resubmitRes = await dispatchAction(
          "assignment.submit",
          { institution: inst.slug, input: { assignmentId, text: "revised answer" } },
          studentAuth,
        );
        expect(resubmitRes.status).toBe(200);
        const resubmitBody = await resubmitRes.json();
        expect(resubmitBody.ok).toBe(true);
        expect(resubmitBody.data.submissionId).toBe(submissionId);
        expect(resubmitBody.data.attempt).toBe(2);

        // --- Direct PostgREST insert with another student's id -> denied -----
        const directInsert = await inst.clientAs("student").from("assignment_submissions").insert({
          institution_id: inst.institutionId,
          assignment_id: assignmentId,
          student_id: otherStudentId,
          content: { text: "forged" },
        });
        expect(directInsert.error).not.toBeNull();

        // --- Student attaches a document to own submission --------------------
        const requestUploadRes = await dispatchAction(
          "document.requestUpload",
          {
            institution: inst.slug,
            input: {
              entityType: "submission",
              entityId: submissionId,
              kind: "attachment",
              fileName: "answer.pdf",
              mime: "application/pdf",
              sizeBytes: 1000,
            },
          },
          studentAuth,
        );
        expect(requestUploadRes.status).toBe(200);
        const requestUploadBody = await requestUploadRes.json();
        expect(requestUploadBody.ok).toBe(true);

        const uploaded = await inst
          .clientAs("student")
          .storage.from("tenant-docs")
          .uploadToSignedUrl(
            requestUploadBody.data.path,
            requestUploadBody.data.token,
            Buffer.from("%PDF-1.4 minimal"),
            { contentType: "application/pdf" },
          );
        expect(uploaded.error).toBeNull();

        const confirmRes = await dispatchAction(
          "document.confirmUpload",
          { institution: inst.slug, input: { documentId: requestUploadBody.data.documentId } },
          studentAuth,
        );
        expect(confirmRes.status).toBe(200);
        const confirmBody = await confirmRes.json();
        expect(confirmBody.ok).toBe(true);
        expect(confirmBody.data.status).toBe("active");

        // --- Teacher reads roster -> submission + documentCount 1 -------------
        const rosterRes = await dispatchQuery(
          "academics.submissionsForAssignment",
          inst.slug,
          { assignmentId },
          teacherAuth,
        );
        expect(rosterRes.status).toBe(200);
        const rosterBody = await rosterRes.json();
        expect(rosterBody.ok).toBe(true);
        const rosterRow = rosterBody.data.find((row: { studentId: string }) => row.studentId === studentId);
        expect(rosterRow).toBeDefined();
        expect(rosterRow.submissionId).toBe(submissionId);
        expect(rosterRow.state).toBe("submitted");
        expect(rosterRow.documentCount).toBe(1);

        // --- Teacher grades ------------------------------------------------
        const gradeRes = await dispatchAction(
          "assignment.grade",
          { institution: inst.slug, input: { submissionId, score: 8, maxScore: 10, feedback: "Good work" } },
          teacherAuth,
        );
        expect(gradeRes.status).toBe(200);
        const gradeBody = await gradeRes.json();
        expect(gradeBody.ok).toBe(true);
        expect(gradeBody.data.status).toBe("graded");

        // --- Accountant cannot grade (permission) -> 403 ----------------------
        const accountantGradeRes = await dispatchAction(
          "assignment.grade",
          { institution: inst.slug, input: { submissionId, score: 1, maxScore: 10 } },
          accountantAuth,
        );
        expect(accountantGradeRes.status).toBe(403);
        const accountantGradeBody = await accountantGradeRes.json();
        expect(accountantGradeBody.ok).toBe(false);

        // --- Resubmit after grading -> 409 invalid_state -----------------------
        const resubmitAfterGradeRes = await dispatchAction(
          "assignment.submit",
          { institution: inst.slug, input: { assignmentId, text: "too late" } },
          studentAuth,
        );
        expect(resubmitAfterGradeRes.status).toBe(409);
        const resubmitAfterGradeBody = await resubmitAfterGradeRes.json();
        expect(resubmitAfterGradeBody.ok).toBe(false);
        expect(resubmitAfterGradeBody.error.code).toBe("invalid_state");

        // --- Guardian sees own child's feedback ---------------------------
        const guardianOwnRes = await dispatchQuery(
          "academics.mySubmissions",
          inst.slug,
          { studentId },
          guardianAuth,
        );
        expect(guardianOwnRes.status).toBe(200);
        const guardianOwnBody = await guardianOwnRes.json();
        expect(guardianOwnBody.ok).toBe(true);
        const guardianRow = guardianOwnBody.data.find((row: { assignmentId: string }) => row.assignmentId === assignmentId);
        expect(guardianRow).toBeDefined();
        expect(guardianRow.state).toBe("graded");
        expect(guardianRow.feedback).toBe("Good work");
        expect(guardianRow.score).toBe(8);

        // --- Guardian cannot see another family's child -> [] ------------------
        const guardianOtherRes = await dispatchQuery(
          "academics.mySubmissions",
          inst.slug,
          { studentId: otherStudentId },
          guardianAuth,
        );
        expect(guardianOtherRes.status).toBe(200);
        const guardianOtherBody = await guardianOtherRes.json();
        expect(guardianOtherBody.ok).toBe(true);
        expect(guardianOtherBody.data).toEqual([]);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
