// T-036 — exercises the real exported `POST` handler of
// `src/app/api/ai/quiz/route.ts` against the live Supabase instance, same
// pattern as `tests/db/public-enquiry-route.test.ts` ("exercise the real
// route handler function", not a mock of the route itself). Only
// `@/lib/supabase/server` (so `getTenantContext`/the route's own queries
// can run a real signed-in client without Next's request-scoped
// `cookies()` — same technique as `tests/db/tenant-context.test.ts`) and
// `@/lib/ai/gateway` (packet rule: "with the gateway mocked") are mocked;
// everything else is the real module graph and real RLS.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { TestInstitution } from "../helpers/roles";

let currentClient: SupabaseClient<Database> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  getClaims: async () => {
    if (!currentClient) return null;
    const { data, error } = await currentClient.auth.getClaims();
    if (error || !data) return null;
    return data.claims;
  },
  createClient: async () => currentClient,
}));

vi.mock("@/lib/ai/gateway", () => ({ runStructured: vi.fn() }));

import { runStructured } from "@/lib/ai/gateway";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const runStructuredMock = runStructured as unknown as ReturnType<typeof vi.fn>;

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actingAs(fixture: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0]): void {
  currentClient = fixture.clientAs(role);
}

function quizRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function createCurriculumUnit(
  institutionId: string,
  subjectId: string,
  gradeId: string,
  overrides: Partial<{ title: string; description: string; sequence: number }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (
      ${institutionId}, ${subjectId}, ${gradeId},
      ${overrides.title ?? "Fractions"},
      ${overrides.description ?? "Adding and subtracting fractions."},
      ${overrides.sequence ?? 1}
    )
    returning id
  `;
  return row.id as string;
}

function validGeneratedContent(count = 10) {
  return {
    questions: Array.from({ length: count }, (_, i) => ({
      stem: `Question ${i + 1}?`,
      options: ["A", "B", "C", "D"],
      answer: "A",
    })),
  };
}

describe("POST /api/ai/quiz (T-036, 06 §W6)", () => {
  it("teacher who teaches the unit's subject in a section of its grade: ok, with the mocked provider/model forwarded", async () => {
    const inst = await createTestInstitution("quiz-route-teacher-ok");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId, { code: "VI", displayName: "Grade VI" });
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const staffId = await staffIdFor(inst.institutionId, "teacher");
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, staffId);
      const unitId = await createCurriculumUnit(inst.institutionId, subjectId, gradeId);

      runStructuredMock.mockResolvedValue({
        ok: true,
        data: { data: validGeneratedContent(10), provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      actingAs(inst, "teacher");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 10, difficulty: "medium" }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.provider).toBe("local");
      expect(body.data.content.questions).toHaveLength(10);
      expect(runStructuredMock).toHaveBeenCalledTimes(1);
      const call = runStructuredMock.mock.calls[0][0];
      expect(call.feature).toBe("quiz_generation");
      expect(call.prompt).toContain("Fractions");
      // Phase 1b production requirement: every call MUST bound output
      // tokens so a request can't run unbounded against the local model
      // (see T-036-report.md "Phase 1b").
      expect(call.maxOutputTokens).toBeTypeOf("number");
      expect(call.maxOutputTokens).toBeGreaterThan(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("owner bypasses the teaches-subject scope check (07 §2.2 org-wide role)", async () => {
    const inst = await createTestInstitution("quiz-route-owner-ok");
    try {
      const gradeId = await createGrade(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId);
      const unitId = await createCurriculumUnit(inst.institutionId, subjectId, gradeId);

      runStructuredMock.mockResolvedValue({
        ok: true,
        data: { data: validGeneratedContent(5), provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      actingAs(inst, "owner");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian.one gets forbidden (no ai.generate permission) and the gateway is never called", async () => {
    const inst = await createTestInstitution("quiz-route-guardian-forbidden");
    try {
      const gradeId = await createGrade(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId);
      const unitId = await createCurriculumUnit(inst.institutionId, subjectId, gradeId);

      actingAs(inst, "guardian");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher on a unit whose subject they don't teach in that grade gets forbidden", async () => {
    const inst = await createTestInstitution("quiz-route-teacher-wrong-scope");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const taughtGradeId = await createGrade(inst.institutionId, { code: "VI", displayName: "Grade VI" });
      const taughtSubjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const staffId = await staffIdFor(inst.institutionId, "teacher");
      const taughtSectionId = await createClassSection(inst.institutionId, taughtGradeId, yearId, { name: "A" });
      await createSubjectAssignment(inst.institutionId, taughtSectionId, taughtSubjectId, staffId);

      // A different subject in the same grade, which this teacher has no
      // `subject_assignments` row for.
      const otherSubjectId = await createSubject(inst.institutionId, { name: "Science" });
      const unitId = await createCurriculumUnit(inst.institutionId, otherSubjectId, taughtGradeId, {
        title: "Photosynthesis",
      });

      actingAs(inst, "teacher");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("questionCount: 50 -> validation_failed with a field error, before any DB or gateway call", async () => {
    const inst = await createTestInstitution("quiz-route-validation");
    try {
      actingAs(inst, "teacher");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({
          institutionSlug: inst.slug,
          curriculumUnitId: "11111111-1111-4111-8111-111111111111",
          questionCount: 50,
          difficulty: "medium",
        }),
      );

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.fieldErrors.questionCount).toBeDefined();
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("unknown curriculum unit id -> not_found", async () => {
    const inst = await createTestInstitution("quiz-route-unit-not-found");
    try {
      actingAs(inst, "owner");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({
          institutionSlug: inst.slug,
          curriculumUnitId: "22222222-2222-4222-8222-222222222222",
          questionCount: 5,
          difficulty: "easy",
        }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await inst.cleanup();
    }
  });

  // Fix round 1 (security review, LOW — missing test): a unit id that is
  // real, but belongs to a DIFFERENT institution, must 404 the same as an
  // unknown id — existence of a unit outside the caller's tenant is never
  // revealed (06 §1.1), and this also proves the route's own
  // `institution_id` scoping (not just RLS) actually filters cross-tenant.
  it("a curriculumUnitId that belongs to a different institution -> not_found", async () => {
    const instA = await createTestInstitution("quiz-route-cross-tenant-a");
    const instB = await createTestInstitution("quiz-route-cross-tenant-b");
    try {
      const gradeIdB = await createGrade(instB.institutionId);
      const subjectIdB = await createSubject(instB.institutionId);
      const unitIdInB = await createCurriculumUnit(instB.institutionId, subjectIdB, gradeIdB);

      actingAs(instA, "owner");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: instA.slug, curriculumUnitId: unitIdInB, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "not_found" } });
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("gateway ai_unavailable (Ollama offline) is forwarded as-is; nothing is persisted here", async () => {
    const inst = await createTestInstitution("quiz-route-ai-unavailable");
    try {
      const gradeId = await createGrade(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId);
      const unitId = await createCurriculumUnit(inst.institutionId, subjectId, gradeId);

      runStructuredMock.mockResolvedValue({
        ok: false,
        error: { code: "ai_unavailable", message: "Local AI engine is not reachable (policy: local_only)." },
      });

      actingAs(inst, "owner");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "ai_unavailable" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a model output that violates QuizContentSchema's invariants (duplicate options) after passing the refine-free generation schema -> ai_invalid_output", async () => {
    const inst = await createTestInstitution("quiz-route-invalid-output");
    try {
      const gradeId = await createGrade(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId);
      const unitId = await createCurriculumUnit(inst.institutionId, subjectId, gradeId);

      runStructuredMock.mockResolvedValue({
        ok: true,
        data: {
          data: { questions: [{ stem: "Q1?", options: ["A", "A", "B", "C"], answer: "A" }] },
          provider: "local",
          model: "qwen3:4b-instruct-2507-q4_K_M",
          fallback: false,
        },
      });

      actingAs(inst, "owner");
      const { POST } = await import("@/app/api/ai/quiz/route");
      const res = await POST(
        quizRequest({ institutionSlug: inst.slug, curriculumUnitId: unitId, questionCount: 5, difficulty: "easy" }),
      );

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: { code: "ai_invalid_output" } });
    } finally {
      await inst.cleanup();
    }
  });
});
