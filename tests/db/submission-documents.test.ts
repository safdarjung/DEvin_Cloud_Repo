import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { confirmUpload, getReadUrl, requestUpload } from "@/modules/documents/actions";
import { listDocumentsForEntity } from "@/modules/documents/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
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

// M09-T5 — documents: enable the `submission` entity in requestUpload.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function studentIdOf(institutionId: string, userId: string): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return row.student_id as string;
}

interface Fixture {
  sectionId: string;
  teacherStaffId: string;
  studentId: string;
  assignmentId: string;
}

/** Published assignment, student enrolled in its section, scoped teacher. */
async function setupFixture(inst: TestInstitution): Promise<Fixture> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  const subjectId = await createSubject(inst.institutionId);
  const teacherId = await teacherStaffId(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherId);
  const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId);
  const [assignment] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by)
    values (${inst.institutionId}, ${sectionId}, ${subjectId}, 'Worksheet', 'published', ${teacherId})
    returning id
  `;
  return { sectionId, teacherStaffId: teacherId, studentId, assignmentId: assignment.id as string };
}

async function submit(inst: TestInstitution, assignmentId: string): Promise<string> {
  const { data, error } = await inst.clientAs("student").rpc("submit_assignment", {
    p_assignment_id: assignmentId,
    p_text: "my answer",
  });
  if (error) throw error;
  return data.id as string;
}

async function uploadPdf(inst: TestInstitution, submissionId: string): Promise<string> {
  const requested = await callAs(inst, "student", requestUpload, {
    entityType: "submission",
    entityId: submissionId,
    kind: "scan",
    fileName: "answer.pdf",
    mime: "application/pdf",
    sizeBytes: 1000,
  });
  if (!requested.ok) throw new Error(`requestUpload failed: ${requested.error.code}`);
  const uploaded = await inst
    .clientAs("student")
    .storage.from("tenant-docs")
    .uploadToSignedUrl(requested.data.path, requested.data.token, Buffer.from("%PDF-1.4 minimal"), {
      contentType: "application/pdf",
    });
  if (uploaded.error) throw uploaded.error;
  const confirmed = await callAs(inst, "student", confirmUpload, { documentId: requested.data.documentId });
  if (!confirmed.ok) throw new Error(`confirmUpload failed: ${confirmed.error.code}`);
  return requested.data.documentId;
}

describe("documents: submission entity (M09-T5)", () => {
  it("student requestUpload + confirmUpload on own submission -> active", async () => {
    const inst = await createTestInstitution("sub-doc-own");
    try {
      const fx = await setupFixture(inst);
      const submissionId = await submit(inst, fx.assignmentId);
      const documentId = await uploadPdf(inst, submissionId);

      const [row] = await sql`select status, entity_type, entity_id from public.documents where id = ${documentId}`;
      expect(row.status).toBe("active");
      expect(row.entity_type).toBe("submission");
      expect(row.entity_id).toBe(submissionId);
    } finally {
      await inst.cleanup();
    }
  });

  it("requestUpload on another student's submission -> not_found", async () => {
    const inst = await createTestInstitution("sub-doc-other-student");
    try {
      const fx = await setupFixture(inst);
      // A submission belonging to a student the caller is not (raw insert,
      // same institution — only `postgres`'s own connection can bypass RLS).
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
        returning id
      `;
      const [otherSubmission] = await sql`
        insert into public.assignment_submissions (institution_id, assignment_id, student_id)
        values (${inst.institutionId}, ${fx.assignmentId}, ${otherStudent.id})
        returning id
      `;

      const result = await callAs(inst, "student", requestUpload, {
        entityType: "submission",
        entityId: otherSubmission.id as string,
        kind: "scan",
        fileName: "answer.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("requestUpload after grading -> forbidden", async () => {
    const inst = await createTestInstitution("sub-doc-graded");
    try {
      const fx = await setupFixture(inst);
      const submissionId = await submit(inst, fx.assignmentId);

      const graded = await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submissionId,
        p_score: 8,
        p_max_score: 10,
      });
      expect(graded.error).toBeNull();

      const result = await callAs(inst, "student", requestUpload, {
        entityType: "submission",
        entityId: submissionId,
        kind: "scan",
        fileName: "answer.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("in-scope teacher lists and reads the submission's document", async () => {
    const inst = await createTestInstitution("sub-doc-teacher-scope");
    try {
      const fx = await setupFixture(inst);
      const submissionId = await submit(inst, fx.assignmentId);
      await uploadPdf(inst, submissionId);

      const teacherCtx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as Parameters<typeof setActingClient>[0]);
      const docs = await listDocumentsForEntity(teacherCtx, "submission", submissionId);
      setActingClient(null);
      expect(docs).toHaveLength(1);

      const read = await callAs(inst, "teacher", getReadUrl, { documentId: docs[0].id });
      expect(read.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian of another family sees no documents for the submission", async () => {
    const inst = await createTestInstitution("sub-doc-guardian-other-family");
    try {
      const fx = await setupFixture(inst);
      const submissionId = await submit(inst, fx.assignmentId);
      await uploadPdf(inst, submissionId);

      // Default guardian fixture has no linked child, so my_student_ids() is
      // empty — it reads no row of someone else's family's submission.
      const guardianCtx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian") as unknown as Parameters<typeof setActingClient>[0]);
      const docs = await listDocumentsForEntity(guardianCtx, "submission", submissionId);
      setActingClient(null);
      expect(docs).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("student requestUpload with entityType 'student' -> forbidden", async () => {
    const inst = await createTestInstitution("sub-doc-student-entity");
    try {
      const fx = await setupFixture(inst);

      const result = await callAs(inst, "student", requestUpload, {
        entityType: "student",
        entityId: fx.studentId,
        kind: "id_proof",
        fileName: "aadhaar.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
