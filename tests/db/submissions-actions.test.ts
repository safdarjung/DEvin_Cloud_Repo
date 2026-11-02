import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { gradeSubmission, submitAssignment } from "@/modules/academics/submissions.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M09-T4 — assignment.submit / assignment.grade (thin RPC wrappers over
// migration 0071's submit_assignment/grade_submission). Fixture setup
// mirrors tests/db/submissions-rls.test.ts's setupBase.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function membershipStudentId(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  return row.student_id as string;
}

async function createAssignment(institutionId: string, classSectionId: string, subjectId: string, createdBy: string): Promise<string> {
  const [row] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by)
    values (${institutionId}, ${classSectionId}, ${subjectId}, 'Worksheet', 'published', ${createdBy})
    returning id
  `;
  return row.id as string;
}

interface Base {
  sectionA: string;
  teacherStaffId: string;
  subjectId: string;
  studentId: string;
}

async function setupBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectId = await createSubject(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionA, subjectId, teacherStaff);
  const student = await membershipStudentId(inst);
  await createEnrolment(inst.institutionId, student, sectionA, yearId);
  return { sectionA, teacherStaffId: teacherStaff, subjectId, studentId: student };
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("assignment.submit / assignment.grade actions (M09-T4)", () => {
  it("student submits then resubmits (attempt 2)", async () => {
    const inst = await createTestInstitution("sub-action-resubmit");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const first = await callAs(inst, "student", submitAssignment, { assignmentId, text: "v1" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.attempt).toBe(1);
      expect(first.data.status).toBe("submitted");

      const second = await callAs(inst, "student", submitAssignment, { assignmentId, text: "v2" });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.submissionId).toBe(first.data.submissionId);
      expect(second.data.attempt).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot submit an assignment (forbidden)", async () => {
    const inst = await createTestInstitution("sub-action-guardian-forbidden");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const result = await callAs(inst, "guardian", submitAssignment, { assignmentId });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher grades a submission", async () => {
    const inst = await createTestInstitution("sub-action-grade");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const submit = await callAs(inst, "student", submitAssignment, { assignmentId });
      expect(submit.ok).toBe(true);
      if (!submit.ok) return;

      const graded = await callAs(inst, "teacher", gradeSubmission, {
        submissionId: submit.data.submissionId,
        score: 8,
        maxScore: 10,
        feedback: "Good work",
      });
      expect(graded.ok).toBe(true);
      if (!graded.ok) return;
      expect(graded.data.status).toBe("graded");
      expect(graded.data.score).toBe(8);
      expect(graded.data.maxScore).toBe(10);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant cannot grade (forbidden — no assignment.manage)", async () => {
    const inst = await createTestInstitution("sub-action-accountant-forbidden");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const submit = await callAs(inst, "student", submitAssignment, { assignmentId });
      expect(submit.ok).toBe(true);
      if (!submit.ok) return;

      const result = await callAs(inst, "accountant", gradeSubmission, {
        submissionId: submit.data.submissionId,
        score: 5,
        maxScore: 10,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("resubmit after grading -> invalid_state", async () => {
    const inst = await createTestInstitution("sub-action-resubmit-after-grade");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const submit = await callAs(inst, "student", submitAssignment, { assignmentId });
      expect(submit.ok).toBe(true);
      if (!submit.ok) return;

      const graded = await callAs(inst, "teacher", gradeSubmission, {
        submissionId: submit.data.submissionId,
        score: 9,
        maxScore: 10,
      });
      expect(graded.ok).toBe(true);

      const resubmit = await callAs(inst, "student", submitAssignment, { assignmentId });
      expect(resubmit.ok).toBe(false);
      if (resubmit.ok) return;
      expect(resubmit.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("grading an unknown submission id -> not_found", async () => {
    const inst = await createTestInstitution("sub-action-grade-not-found");
    try {
      await setupBase(inst);
      const result = await callAs(inst, "teacher", gradeSubmission, {
        submissionId: crypto.randomUUID(),
        score: 5,
        maxScore: 10,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
