import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review) — only this file's module graph gets
// them; every other db test file keeps the real `@/lib/supabase/server`.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
// `revalidatePath` needs a real Next.js request/render scope ("static
// generation store"), which doesn't exist under Vitest — the actions call
// it after their DB work, so leaving it real turns a successful create into
// a caught "internal" error here. No-op it for this file only.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { createAssignment, publishAssignment, updateAssignment } from "@/modules/academics/assignments.actions";
import { getAssignment, listStudentAssignments } from "@/modules/academics/assignments.queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'
  `;
  return row.staff_id as string;
}

describe("assignments module (T-022) — real actions via callAs + the mocked server client", () => {
  it("a teacher creates and publishes a draft for a subject they teach -> ok, with an assignment.published audit row", async () => {
    const inst = await createTestInstitution("assignments-create-publish");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Chapter 4 worksheet",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const published = await callAs(inst, "teacher", publishAssignment, { assignmentId: created.data.id });
      expect(published.ok).toBe(true);

      const [row] = await sql`select status from public.assignments where id = ${created.data.id}::uuid`;
      expect(row.status).toBe("published");

      const auditRows = await sql`
        select action, entity_type, entity_id, before, after from public.audit_events
        where entity_id = ${created.data.id}::uuid and action = 'assignment.published'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].entity_type).toBe("assignment");
      expect(auditRows[0].before).toEqual({ status: "draft" });
      expect(auditRows[0].after).toEqual({ status: "published" });
    } finally {
      await inst.cleanup();
    }
  });

  it("publishing the same assignment twice: the second call gets invalid_state, not a false ok, and no second audit row", async () => {
    const inst = await createTestInstitution("assignments-publish-race");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "HW1",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const firstPublish = await callAs(inst, "teacher", publishAssignment, { assignmentId: created.data.id });
      expect(firstPublish.ok).toBe(true);

      // A second publish — whether from a lost race with another caller or
      // a stale client retry — must not report success and must not write
      // a second audit row (`.update(...).eq("status","draft")` now matches
      // 0 rows and the action maps that to invalid_state instead of ok).
      const secondPublish = await callAs(inst, "teacher", publishAssignment, { assignmentId: created.data.id });
      expect(secondPublish).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      const auditRows = await sql`
        select id from public.audit_events
        where entity_id = ${created.data.id}::uuid and action = 'assignment.published'
      `;
      expect(auditRows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher who teaches the section for a DIFFERENT subject gets forbidden", async () => {
    const inst = await createTestInstitution("assignments-subject-scope");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectTaught = await createSubject(inst.institutionId, { code: "MATH" });
      const subjectNotTaught = await createSubject(inst.institutionId, { code: "SCI" });
      await createSubjectAssignment(inst.institutionId, sectionA, subjectTaught, staffId);

      const result = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId: subjectNotTaught,
        title: "Should be rejected",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("ids from another institution are not found, even for a section/subject a teacher owns at home", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearIdA = await createAcademicYear(instA.institutionId);
      const gradeIdA = await createGrade(instA.institutionId);
      const sectionA = await createClassSection(instA.institutionId, gradeIdA, yearIdA, { name: "A" });
      const subjectA = await createSubject(instA.institutionId);

      // instB's teacher tries to create against instA's ids, through instB's context.
      const result = await callAs(instB, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId: subjectA,
        title: "Cross-institution attempt",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  it("editing a published assignment returns invalid_state", async () => {
    const inst = await createTestInstitution("assignments-invalid-state");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "HW1",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const published = await callAs(inst, "teacher", publishAssignment, { assignmentId: created.data.id });
      expect(published.ok).toBe(true);

      const edited = await callAs(inst, "teacher", updateAssignment, {
        assignmentId: created.data.id,
        title: "Too late",
      });
      expect(edited).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("an accountant is forbidden from creating an assignment (no assignment.manage)", async () => {
    const inst = await createTestInstitution("assignments-accountant-forbidden");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);

      const result = await callAs(inst, "accountant", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Should be rejected",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("listStudentAssignments (guardian/student portal query) returns only published assignments for the student's active section", async () => {
    const inst = await createTestInstitution("assignments-published-only-query");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const [studentRow] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
      `;
      const studentId = studentRow.student_id as string;
      await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { rollNo: 1 });

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Draft HW",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const createdPublished = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Published HW",
      });
      expect(createdPublished.ok).toBe(true);
      if (!createdPublished.ok) return;
      const publishResult = await callAs(inst, "teacher", publishAssignment, {
        assignmentId: createdPublished.data.id,
      });
      expect(publishResult.ok).toBe(true);

      const studentCtx = await buildContext(inst, "student");
      setActingClient(inst.clientAs("student") as unknown as SupabaseClient<Database>);
      let titles: string[];
      try {
        const assignments = await listStudentAssignments(studentCtx, studentId);
        titles = assignments.map((a) => a.title);
      } finally {
        setActingClient(null);
      }

      expect(titles).toContain("Published HW");
      expect(titles).not.toContain("Draft HW");
    } finally {
      await inst.cleanup();
    }
  });

  it("DBT-21: quiz answers live only in assignment_answer_keys — a guardian/student's direct select on assignments.content never returns them, and the answer-keys table returns 0 rows for them", async () => {
    const inst = await createTestInstitution("assignments-answer-keys");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const [studentRow] = await sql`
        select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'
      `;
      const studentId = studentRow.student_id as string;
      await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { rollNo: 1 });

      const [guardianRow] = await sql`
        select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianRow.guardian_id}, ${studentId}, 'mother', true)
      `;

      const quizContent = {
        questions: [{ stem: "2 + 2 = ?", options: ["3", "4", "5", "6"], answer: "4", explanation: "Basic addition." }],
      };

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Quiz HW",
        content: quizContent,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const assignmentId = created.data.id;

      // The row the DB actually stores never has an "answer" key at all —
      // not just redacted by the app layer.
      const [storedRow] = await sql`select content from public.assignments where id = ${assignmentId}::uuid`;
      const storedQuestions = (storedRow.content as { questions: Array<Record<string, unknown>> }).questions;
      expect(storedQuestions[0]).not.toHaveProperty("answer");
      expect(storedQuestions[0]).not.toHaveProperty("explanation");

      const [keyRow] = await sql`select answers from public.assignment_answer_keys where assignment_id = ${assignmentId}::uuid`;
      expect((keyRow.answers as { questions: Array<{ answer: string }> }).questions[0].answer).toBe("4");

      const published = await callAs(inst, "teacher", publishAssignment, { assignmentId });
      expect(published.ok).toBe(true);

      // The teacher (assignment.manage) sees the real answer through
      // getAssignment — content and the answer key are merged back together.
      const teacherCtx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      try {
        const asTeacher = await getAssignment(teacherCtx, assignmentId);
        expect(asTeacher?.content?.questions[0].answer).toBe("4");
      } finally {
        setActingClient(null);
      }

      // A guardian/student (no assignment.manage) gets the redacted shape
      // from getAssignment, AND a direct PostgREST select on the answer-keys
      // table returns zero rows — RLS, not just the app layer, denies it.
      for (const role of ["guardian", "student"] as const) {
        const ctx = await buildContext(inst, role);
        setActingClient(inst.clientAs(role) as unknown as SupabaseClient<Database>);
        try {
          const asViewer = await getAssignment(ctx, assignmentId);
          expect(asViewer?.content?.questions[0].answer).toBe("");
          expect(asViewer?.content?.questions[0].explanation).toBeUndefined();
        } finally {
          setActingClient(null);
        }

        const direct = await inst
          .clientAs(role)
          .from("assignment_answer_keys")
          .select("answers")
          .eq("assignment_id", assignmentId);
        expect(direct.data ?? []).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("fix round 1 (review MED): publishing a quiz with a missing/out-of-date answer key is rejected, and re-saving the draft recovers it", async () => {
    const inst = await createTestInstitution("assignments-publish-key-guard");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const staffId = await teacherStaffId(inst.institutionId);
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      await createSubjectAssignment(inst.institutionId, sectionA, subjectId, staffId);

      const quizContent = {
        questions: [{ stem: "2 + 2 = ?", options: ["3", "4", "5", "6"], answer: "4", explanation: "Basic addition." }],
      };

      const created = await callAs(inst, "teacher", createAssignment, {
        classSectionId: sectionA,
        subjectId,
        title: "Quiz HW (key guard)",
        content: quizContent,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const assignmentId = created.data.id;

      // Simulate the non-transactional write's failure mode directly: the
      // key row is gone (or, equivalently, answers-count mismatched), the
      // way the two-write race in createAssignment/updateAssignment could
      // leave it. Deletion as the raw `postgres` connection, not through
      // RLS — no app code is ever expected to delete this row.
      await sql`delete from public.assignment_answer_keys where assignment_id = ${assignmentId}::uuid`;

      const publishMissingKey = await callAs(inst, "teacher", publishAssignment, { assignmentId });
      expect(publishMissingKey).toMatchObject({
        ok: false,
        error: { code: "validation_failed", message: "Answer key missing or out of date — re-save the draft" },
      });

      const [stillDraft] = await sql`select status from public.assignments where id = ${assignmentId}::uuid`;
      expect(stillDraft.status).toBe("draft");

      // Re-saving the draft (updateAssignment with the same content)
      // re-upserts the key — the teacher can recover without touching the DB.
      const resaved = await callAs(inst, "teacher", updateAssignment, { assignmentId, content: quizContent });
      expect(resaved.ok).toBe(true);

      const [keyRow] = await sql`select answers from public.assignment_answer_keys where assignment_id = ${assignmentId}::uuid`;
      expect((keyRow.answers as { questions: Array<{ answer: string }> }).questions).toHaveLength(1);

      const publishAfterResave = await callAs(inst, "teacher", publishAssignment, { assignmentId });
      expect(publishAfterResave).toMatchObject({ ok: true });

      const [nowPublished] = await sql`select status from public.assignments where id = ${assignmentId}::uuid`;
      expect(nowPublished.status).toBe("published");
    } finally {
      await inst.cleanup();
    }
  });
});
