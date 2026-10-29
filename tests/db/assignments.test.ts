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
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
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
});
