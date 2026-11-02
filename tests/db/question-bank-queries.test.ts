import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createQuestion } from "@/modules/question-bank/actions";
import { questionBankListQuery } from "@/modules/question-bank/query-defs";
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

interface Base {
  gradeId: string;
  subjectTaught: string;
  subjectUntaught: string;
}

/** One grade, one subject the fixture "teacher" teaches, one it doesn't. */
async function buildBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectTaught = await createSubject(inst.institutionId, { code: "MATH" });
  const subjectUntaught = await createSubject(inst.institutionId, { code: "SCI" });
  const [{ staff_id: teacherStaffId }] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  await createSubjectAssignment(inst.institutionId, sectionA, subjectTaught, teacherStaffId as string);
  return { gradeId, subjectTaught, subjectUntaught };
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

describe("questionBank.list (M11-T8)", () => {
  it("exam_controller sees all questions in the institution", async () => {
    const inst = await createTestInstitution("qb-list-controller-all");
    try {
      const base = await buildBase(inst);
      await callAs(inst, "exam_controller", createQuestion, createInput(base));
      await callAs(inst, "teacher", createQuestion, createInput(base, { body: "Taught-scope question" }));

      const result = await callAs(inst, "exam_controller", questionBankListQuery, { page: 1, pageSize: 50 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher sees only questions in their taught (grade, subject) scope", async () => {
    const inst = await createTestInstitution("qb-list-teacher-scope");
    try {
      const base = await buildBase(inst);
      await callAs(inst, "exam_controller", createQuestion, createInput(base, { subjectId: base.subjectUntaught, body: "Outside teacher scope" }));
      await callAs(inst, "teacher", createQuestion, createInput(base, { body: "In teacher scope" }));

      const result = await callAs(inst, "teacher", questionBankListQuery, { page: 1, pageSize: 50 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].body).toBe("In teacher scope");
    } finally {
      await inst.cleanup();
    }
  });

  it("archived questions are hidden unless includeArchived is set", async () => {
    const inst = await createTestInstitution("qb-list-archived");
    try {
      const base = await buildBase(inst);
      const created = await callAs(inst, "exam_controller", createQuestion, createInput(base));
      if (!created.ok) throw new Error("fixture create failed");
      await sql`update public.question_bank set is_active = false where id = ${created.data.id}`;

      const hidden = await callAs(inst, "exam_controller", questionBankListQuery, { page: 1, pageSize: 50 });
      expect(hidden.ok).toBe(true);
      if (hidden.ok) expect(hidden.data.items).toHaveLength(0);

      const shown = await callAs(inst, "exam_controller", questionBankListQuery, {
        page: 1,
        pageSize: 50,
        includeArchived: true,
      });
      expect(shown.ok).toBe(true);
      if (shown.ok) expect(shown.data.items).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("filters by difficulty", async () => {
    const inst = await createTestInstitution("qb-list-difficulty");
    try {
      const base = await buildBase(inst);
      await callAs(inst, "exam_controller", createQuestion, createInput(base, { difficulty: "easy", body: "Easy one" }));
      await callAs(inst, "exam_controller", createQuestion, createInput(base, { difficulty: "hard", body: "Hard one" }));

      const result = await callAs(inst, "exam_controller", questionBankListQuery, {
        page: 1,
        pageSize: 50,
        difficulty: "hard",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].difficulty).toBe("hard");
    } finally {
      await inst.cleanup();
    }
  });

  it("pages results and reports total across pages", async () => {
    const inst = await createTestInstitution("qb-list-paging");
    try {
      const base = await buildBase(inst);
      for (let i = 0; i < 3; i++) {
        await callAs(inst, "exam_controller", createQuestion, createInput(base, { body: `Question ${i}` }));
      }

      const page1 = await callAs(inst, "exam_controller", questionBankListQuery, { page: 1, pageSize: 2 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.data.items).toHaveLength(2);
      expect(page1.data.total).toBe(3);

      const page2 = await callAs(inst, "exam_controller", questionBankListQuery, { page: 2, pageSize: 2 });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.data.items).toHaveLength(1);
      expect(page2.data.total).toBe(3);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian is forbidden (no question.manage permission)", async () => {
    const inst = await createTestInstitution("qb-list-guardian-forbidden");
    try {
      const result = await callAs(inst, "guardian", questionBankListQuery, { page: 1, pageSize: 50 });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });
});
