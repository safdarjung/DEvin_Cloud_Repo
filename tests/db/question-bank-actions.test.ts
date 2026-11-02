import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { archiveQuestion, createQuestion, updateQuestion } from "@/modules/question-bank/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherIds(institutionId: string): Promise<{ userId: string; staffId: string }> {
  const [row] = await sql`
    select user_id, staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'
  `;
  return { userId: row.user_id as string, staffId: row.staff_id as string };
}

async function userId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select user_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.user_id as string;
}

interface Base {
  gradeId: string;
  subjectTaught: string;
  subjectUntaught: string;
  teacherUserId: string;
}

/** One grade, one subject the fixture "teacher" teaches, one it doesn't. */
async function buildBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectTaught = await createSubject(inst.institutionId, { code: "MATH" });
  const subjectUntaught = await createSubject(inst.institutionId, { code: "SCI" });
  const { userId: teacherUserId, staffId: teacherStaffId } = await teacherIds(inst.institutionId);
  await createSubjectAssignment(inst.institutionId, sectionA, subjectTaught, teacherStaffId);
  return { gradeId, subjectTaught, subjectUntaught, teacherUserId };
}

function createInput(base: Base, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    subjectId: base.subjectTaught,
    gradeId: base.gradeId,
    type: "short_answer" as const,
    difficulty: "easy" as const,
    body: "Name the capital of India.",
    answer: "New Delhi",
    marks: 2,
    ...overrides,
  };
}

describe("question-bank actions (M11-T4) — questionBank.create/update/archive", () => {
  it("exam_controller creates a question", async () => {
    const inst = await createTestInstitution("qb-action-controller-create");
    try {
      const base = await buildBase(inst);
      const result = await callAs(inst, "exam_controller", createQuestion, createInput(base));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await sql`select created_by, options from public.question_bank where id = ${result.data.id}`;
      expect(row.created_by).toBe(await userId(inst.institutionId, "exam_controller"));
      expect(row.options).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher creates a question in their taught (grade, subject) scope", async () => {
    const inst = await createTestInstitution("qb-action-teacher-create");
    try {
      const base = await buildBase(inst);
      const result = await callAs(inst, "teacher", createQuestion, createInput(base));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await sql`select created_by from public.question_bank where id = ${result.data.id}`;
      expect(row.created_by).toBe(base.teacherUserId);
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher creating a question outside their taught scope gets forbidden", async () => {
    const inst = await createTestInstitution("qb-action-teacher-out-of-scope");
    try {
      const base = await buildBase(inst);
      const result = await callAs(
        inst,
        "teacher",
        createQuestion,
        createInput(base, { subjectId: base.subjectUntaught }),
      );
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher updating another teacher's question gets not_found", async () => {
    const inst = await createTestInstitution("qb-action-teacher-update-not-found");
    try {
      const base = await buildBase(inst);
      const controllerId = await userId(inst.institutionId, "exam_controller");
      const [row] = await sql`
        insert into public.question_bank (institution_id, subject_id, grade_id, type, difficulty, body, answer, marks, created_by)
        values (${inst.institutionId}, ${base.subjectTaught}, ${base.gradeId}, 'short_answer', 'easy', 'Owned by controller', 'ans', 1, ${controllerId})
        returning id
      `;

      const result = await callAs(inst, "teacher", updateQuestion, {
        id: row.id as string,
        ...createInput(base, { body: "Hijacked" }),
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });

      const [after] = await sql`select body from public.question_bank where id = ${row.id}`;
      expect(after.body).toBe("Owned by controller");
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian is forbidden (no question.manage permission)", async () => {
    const inst = await createTestInstitution("qb-action-guardian-forbidden");
    try {
      const base = await buildBase(inst);
      const result = await callAs(inst, "guardian", createQuestion, createInput(base));
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("archive sets is_active = false", async () => {
    const inst = await createTestInstitution("qb-action-archive");
    try {
      const base = await buildBase(inst);
      const created = await callAs(inst, "exam_controller", createQuestion, createInput(base));
      if (!created.ok) throw new Error("setup failed");

      const archived = await callAs(inst, "exam_controller", archiveQuestion, { id: created.data.id, isActive: false });
      expect(archived).toMatchObject({ ok: true, data: { id: created.data.id, isActive: false } });

      const [row] = await sql`select is_active from public.question_bank where id = ${created.data.id}`;
      expect(row.is_active).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });
});
