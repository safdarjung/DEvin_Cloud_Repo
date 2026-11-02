// M09-T6 — src/modules/academics/submissions.queries.ts, called directly as
// plain query functions (buildContext + setActingClient, mirrors
// tests/db/timetable-queries.test.ts). Fixture setup mirrors
// tests/db/submissions-rls.test.ts's setupBase.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { mySubmissions, submissionsForAssignment } from "@/modules/academics/submissions.queries";
import { buildContext } from "../helpers/actions";
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
import { setActingClient } from "../helpers/server-client-mock";

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
  await createEnrolment(inst.institutionId, student, sectionA, yearId, { rollNo: 1 });
  return { yearId, sectionA, teacherStaffId: teacherStaff, subjectId, studentId: student };
}

async function asRole<T>(inst: TestInstitution, role: "teacher" | "student" | "guardian", fn: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>): Promise<T> {
  const ctx = await buildContext(inst, role);
  setActingClient(inst.clientAs(role) as never);
  try {
    return await fn(ctx);
  } finally {
    setActingClient(null);
  }
}

describe("academics.submissionsForAssignment / academics.mySubmissions (M09-T6)", () => {
  it("teacher roster lists every enrolled student, not_submitted for missing ones, isLate true past due", async () => {
    const inst = await createTestInstitution("sub-q-roster");
    try {
      const base = await setupBase(inst);
      const [second] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Second', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, second.id as string, base.sectionA, base.yearId, { rollNo: 2 });

      const pastDue = new Date(Date.now() - 86_400_000).toISOString();
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId, { dueAt: pastDue });
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId, p_text: "late answer" });
      expect(submit.error).toBeNull();

      const roster = await asRole(inst, "teacher", (ctx) => submissionsForAssignment(ctx, assignmentId));

      expect(roster).toHaveLength(2);
      const submitted = roster.find((r) => r.studentId === base.studentId);
      const missing = roster.find((r) => r.studentId === second.id);
      expect(submitted?.state).toBe("submitted");
      expect(submitted?.isLate).toBe(true);
      expect(submitted?.attempt).toBe(1);
      expect(missing?.state).toBe("not_submitted");
      expect(missing?.isLate).toBe(true);
      expect(missing?.attempt).toBe(0);
      expect(missing?.submissionId).toBeNull();
      expect(roster[0].rollNo).toBe(1);
      expect(roster[1].rollNo).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("graded row in the roster carries score and feedback", async () => {
    const inst = await createTestInstitution("sub-q-graded-roster");
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

      const roster = await asRole(inst, "teacher", (ctx) => submissionsForAssignment(ctx, assignmentId));
      const row = roster.find((r) => r.studentId === base.studentId);
      expect(row?.state).toBe("graded");
      expect(row?.score).toBe(8);
      expect(row?.maxScore).toBe(10);
      expect(row?.feedback).toBe("Good work");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian mySubmissions for own child shows feedback, for another family's child returns []", async () => {
    const instA = await createTestInstitution("sub-q-guardian-own");
    const instB = await createTestInstitution("sub-q-guardian-other");
    try {
      const baseA = await setupBase(instA);
      const assignmentA = await createAssignment(instA.institutionId, baseA.sectionA, baseA.subjectId, baseA.teacherStaffId);
      const submitA = await instA.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentA, p_text: "answer" });
      expect(submitA.error).toBeNull();
      await instA.clientAs("teacher").rpc("grade_submission", {
        p_submission_id: submitA.data.id,
        p_score: 9,
        p_max_score: 10,
        p_feedback: "Nice",
      });

      const [guardianMembership] = await sql`
        select guardian_id from public.memberships where institution_id = ${instA.institutionId} and user_id = ${instA.users.guardian.id}
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
        values (${instA.institutionId}, ${guardianMembership.guardian_id}, ${baseA.studentId}, 'father', true, true)
      `;

      const ownResult = await asRole(instA, "guardian", (ctx) => mySubmissions(ctx, baseA.studentId));
      const ownRow = ownResult.find((r) => r.assignmentId === assignmentA);
      expect(ownRow?.state).toBe("graded");
      expect(ownRow?.feedback).toBe("Nice");

      const crossResult = await asRole(instB, "guardian", (ctx) => mySubmissions(ctx, baseA.studentId));
      expect(crossResult).toEqual([]);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("student defaults to own submissions when no studentId is passed", async () => {
    const inst = await createTestInstitution("sub-q-student-default");
    try {
      const base = await setupBase(inst);
      const assignmentId = await createAssignment(inst.institutionId, base.sectionA, base.subjectId, base.teacherStaffId);
      const submit = await inst.clientAs("student").rpc("submit_assignment", { p_assignment_id: assignmentId, p_text: "mine" });
      expect(submit.error).toBeNull();

      const result = await asRole(inst, "student", (ctx) => mySubmissions(ctx));
      expect(result).toHaveLength(1);
      expect(result[0].assignmentId).toBe(assignmentId);
      expect(result[0].state).toBe("submitted");
    } finally {
      await inst.cleanup();
    }
  });
});
