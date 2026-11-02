import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
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

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function createAssignment(
  institutionId: string,
  classSectionId: string,
  subjectId: string,
  createdBy: string,
  overrides: Partial<{ status: string; dueAt: string | null; title: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.assignments (institution_id, class_section_id, subject_id, title, due_at, status, created_by)
    values (
      ${institutionId}, ${classSectionId}, ${subjectId}, ${overrides.title ?? "Worksheet"},
      ${overrides.dueAt ?? null}, ${overrides.status ?? "published"}, ${createdBy}
    )
    returning id
  `;
  return row.id as string;
}

interface Base {
  yearId: string;
  sectionA: string;
  sectionB: string;
  teacherStaffId: string;
  subjectId: string;
  studentId: string;
}

async function setupBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const subjectId = await createSubject(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionA, subjectId, teacherStaff);
  const student = await membershipStudentId(inst);
  await createEnrolment(inst.institutionId, student, sectionA, yearId);
  return { yearId, sectionA, sectionB, teacherStaffId: teacherStaff, subjectId, studentId: student };
}

describe("migration 0071: assignment_submissions RLS + submit/grade RPCs", () => {
  it("student submits to own section's published assignment -> submitted, attempt 1, isLate false", async () => {
    const inst = await createTestInstitution("sub-submit-basic");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const { data, error } = await inst.clientAs("student").rpc("submit_assignment", {
        p_assignment_id: assignmentId,
        p_text: "my answer",
      });

      expect(error).toBeNull();
      expect(data.status).toBe("submitted");
      expect(data.attempt).toBe(1);
      expect(data.is_late).toBe(false);
      expect(data.content).toEqual({ text: "my answer" });
    } finally {
      await inst.cleanup();
    }
  });

  it("resubmit overwrites content in place and increments attempt", async () => {
    const inst = await createTestInstitution("sub-resubmit");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const first = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId, p_text: "v1" });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId, p_text: "v2" });
      expect(second.error).toBeNull();
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.attempt).toBe(2);
      expect(second.data.content).toEqual({ text: "v2" });

      const rows = await sql`select id from public.assignment_submissions where assignment_id = ${assignmentId}::uuid`;
      expect(rows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("submission past due_at is flagged isLate true", async () => {
    const inst = await createTestInstitution("sub-late");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId, {
        dueAt: "2020-01-01T00:00:00Z",
      });

      const { data, error } = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(error).toBeNull();
      expect(data.is_late).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("student not enrolled in the assignment's section gets forbidden", async () => {
    const inst = await createTestInstitution("sub-wrong-section");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionB, base.subjectId, base.teacherStaffId);

      const { error } = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("draft assignment -> not_found", async () => {
    const inst = await createTestInstitution("sub-draft");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId, {
        status: "draft",
      });

      const { error } = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("closed assignment -> invalid_state", async () => {
    const inst = await createTestInstitution("sub-closed");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId, {
        status: "closed",
      });

      const { error } = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("student direct PostgREST insert/update of score is denied (self-grading hole closed)", async () => {
    const inst = await createTestInstitution("sub-direct-write");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);

      const insertAttempt = await inst
        .clientAs("student")
        .from("assignment_submissions")
        .insert({
          institution_id: inst.institutionId,
          assignment_id: assignmentId,
          student_id: base.studentId,
          content: { text: "direct" },
        });
      expect(insertAttempt.error).not.toBeNull();

      const submitted = await sql`
        insert into public.assignment_submissions (institution_id, assignment_id, student_id)
        values (${inst.institutionId}, ${assignmentId}, ${base.studentId})
        returning id
      `;
      // No UPDATE policy at all -> RLS silently matches 0 rows (no error,
      // no change), same denial shape as the INSERT above.
      const updateAttempt = await inst
        .clientAs("student")
        .from("assignment_submissions")
        .update({ score: 10, max_score: 10 })
        .eq("id", submitted[0].id)
        .select("id");
      expect(updateAttempt.error).toBeNull();
      expect(updateAttempt.data).toHaveLength(0);

      const [row] = await sql`select score from public.assignment_submissions where id = ${submitted[0].id}::uuid`;
      expect(row.score).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("subject teacher grades -> graded", async () => {
    const inst = await createTestInstitution("sub-grade-teacher");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(submit.error).toBeNull();

      const grade = await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submit.data.id,
        p_score: 8,
        p_max_score: 10,
        p_feedback: "Good work",
      });
      expect(grade.error).toBeNull();
      expect(grade.data.status).toBe("graded");
      expect(grade.data.score).toBe(8);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher not assigned to the section's subject, and admin, get forbidden on grading", async () => {
    const inst = await createTestInstitution("sub-grade-forbidden");
    try {
      const base = await setupBase(inst);
      // sectionB: the fixture teacher has no subject_assignments row and is
      // not its class teacher, so they are out of grading scope for it.
      const assignmentId = await createAssignment(inst.institutionId, base.sectionB, base.subjectId, base.teacherStaffId);
      const submission = await sql`
        insert into public.assignment_submissions (institution_id, assignment_id, student_id)
        values (${inst.institutionId}, ${assignmentId}, ${base.studentId})
        returning id
      `;

      const teacherAttempt = await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submission[0].id,
        p_score: 5,
        p_max_score: 10,
      });
      expect(teacherAttempt.error).not.toBeNull();
      expect(teacherAttempt.error!.message).toContain("forbidden");

      const adminAttempt = await inst.clientAs("admin").rpc("grade_submission", {
        p_submission_id: submission[0].id,
        p_score: 5,
        p_max_score: 10,
      });
      expect(adminAttempt.error).not.toBeNull();
      expect(adminAttempt.error!.message).toContain("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("score greater than maxScore -> validation_failed", async () => {
    const inst = await createTestInstitution("sub-grade-validation");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(submit.error).toBeNull();

      const grade = await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submit.data.id,
        p_score: 11,
        p_max_score: 10,
      });
      expect(grade.error).not.toBeNull();
      expect(grade.error!.message).toContain("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("resubmit after grading -> invalid_state", async () => {
    const inst = await createTestInstitution("sub-resubmit-after-grade");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(submit.error).toBeNull();

      const grade = await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submit.data.id,
        p_score: 9,
        p_max_score: 10,
      });
      expect(grade.error).toBeNull();

      const resubmit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(resubmit.error).not.toBeNull();
      expect(resubmit.error!.message).toContain("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian reads own child's row with feedback, not another family's", async () => {
    const instA = await createTestInstitution("sub-guardian-own");
    const instB = await createTestInstitution("sub-guardian-other");
    try {
      const baseA = await setupBase(instA);
      const assignmentA = await createAssignment(instA.institutionId, baseA.sectionA, baseA.subjectId, baseA.teacherStaffId);
      const submitA = await instA.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentA });
      expect(submitA.error).toBeNull();
      await instA.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submitA.data.id,
        p_score: 7,
        p_max_score: 10,
        p_feedback: "Nice",
      });

      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${instA.institutionId} and user_id = ${instA.users.guardian.id}
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${instA.institutionId}, ${guardianMembership.guardian_id}, ${baseA.studentId}, 'father', true)
      `;

      const ownRead = await instA
        .clientAs("guardian")
        .from("assignment_submissions")
        .select("feedback")
        .eq("id", submitA.data.id);
      expect(ownRead.error).toBeNull();
      expect(ownRead.data).toHaveLength(1);
      expect(ownRead.data![0].feedback).toBe("Nice");

      const crossRead = await instB
        .clientAs("guardian")
        .from("assignment_submissions")
        .select("feedback")
        .eq("id", submitA.data.id);
      expect(crossRead.error).toBeNull();
      expect(crossRead.data).toHaveLength(0);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("student reads own submissions only, not another student's", async () => {
    const inst = await createTestInstitution("sub-student-own-read");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(submit.error).toBeNull();

      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-OTHER-SUB', 'Other', '2015-01-01', 'other')
        returning id
      `;
      await sql`
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
        values (${inst.institutionId}, ${otherStudent.id}, ${base.sectionA}, ${base.yearId}, '2026-04-01', 'active')
      `;
      const otherSubmission = await sql`
        insert into public.assignment_submissions (institution_id, assignment_id, student_id)
        values (${inst.institutionId}, ${assignmentId}, ${otherStudent.id})
        returning id
      `;

      const ownRead = await inst.clientAs("student").from("assignment_submissions").select("id");
      expect(ownRead.error).toBeNull();
      const ids = ownRead.data!.map((r: { id: string }) => r.id);
      expect(ids).toContain(submit.data.id);
      expect(ids).not.toContain(otherSubmission[0].id);
    } finally {
      await inst.cleanup();
    }
  });

  it("student inserts a pending submission document for own submission, not another's, not after grading; teacher in scope sees it", async () => {
    const inst = await createTestInstitution("sub-documents");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId });
      expect(submit.error).toBeNull();

      const ownDocPath = `${inst.institutionId}/submission/${submit.data.id}/own.pdf`;
      const ownDoc = await inst.clientAs("student").from("documents").insert({
        institution_id: inst.institutionId,
        entity_type: "submission",
        entity_id: submit.data.id,
        kind: "submission_attachment",
        file_name: "own.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
        path: ownDocPath,
        created_by: inst.users.student.id,
      });
      expect(ownDoc.error).toBeNull();

      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-OTHER-DOC', 'Other', '2015-01-01', 'other')
        returning id
      `;
      await sql`
        insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
        values (${inst.institutionId}, ${otherStudent.id}, ${base.sectionA}, ${base.yearId}, '2026-04-01', 'active')
      `;
      const otherSubmission = await sql`
        insert into public.assignment_submissions (institution_id, assignment_id, student_id)
        values (${inst.institutionId}, ${assignmentId}, ${otherStudent.id})
        returning id
      `;
      const foreignDoc = await inst.clientAs("student").from("documents").insert({
        institution_id: inst.institutionId,
        entity_type: "submission",
        entity_id: otherSubmission[0].id,
        kind: "submission_attachment",
        file_name: "foreign.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
        path: `${inst.institutionId}/submission/${otherSubmission[0].id}/foreign.pdf`,
        created_by: inst.users.student.id,
      });
      expect(foreignDoc.error).not.toBeNull();

      await inst.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submit.data.id,
        p_score: 9,
        p_max_score: 10,
      });
      const afterGrade = await inst.clientAs("student").from("documents").insert({
        institution_id: inst.institutionId,
        entity_type: "submission",
        entity_id: submit.data.id,
        kind: "submission_attachment",
        file_name: "late.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
        path: `${inst.institutionId}/submission/${submit.data.id}/late.pdf`,
        created_by: inst.users.student.id,
      });
      expect(afterGrade.error).not.toBeNull();

      const teacherRead = await inst
        .clientAs("teacher")
        .from("documents")
        .select("id")
        .eq("entity_type", "submission")
        .eq("entity_id", submit.data.id);
      expect(teacherRead.error).toBeNull();
      expect(teacherRead.data!.length).toBeGreaterThanOrEqual(1);
    } finally {
      await inst.cleanup();
    }
  });
});
