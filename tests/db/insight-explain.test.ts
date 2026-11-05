// M19-T17 — insight.explain (AI gateway). Gateway mocked per the packet
// (`tests/db/quiz-route.test.ts` pattern: `vi.mock("@/lib/ai/gateway")`);
// everything else — `callAs`, real RLS, the real `set_insight_explanation`
// definer — is real, same as `tests/db/insight-actions.test.ts` (T16).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("@/lib/ai/gateway", () => ({ runStructured: vi.fn() }));

import { runStructured } from "@/lib/ai/gateway";
import { explainInsight } from "@/modules/insights/explain.actions";
import { INSIGHT_EXPLAIN_DATA_BLOCK_MARKER_PATTERN } from "@/modules/insights/explain";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { createAcademicYear, createClassSection, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const runStructuredMock = runStructured as unknown as ReturnType<typeof vi.fn>;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const VALID_EXPLANATION = {
  what: "A small group of students have missed most of the work due in the last month.",
  why: "Could be a run of absence, or the work landing in a week with other deadlines.",
  next_steps: ["Check with the class teacher which students are affected."],
};

beforeEach(() => {
  runStructuredMock.mockReset();
});

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

interface InsightOverrides {
  domain?: string;
  status?: string;
  class_section_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  reviewer_role?: string;
}

async function insertInsight(institutionId: string, overrides: InsightOverrides = {}): Promise<string> {
  const { data, error } = await adminClient()
    .from("insights")
    .insert({
      institution_id: institutionId,
      signal: "academics.missing_work",
      detector_version: 1,
      dedupe_key: `dk-${crypto.randomUUID()}`,
      domain: "academics",
      kind: "descriptive",
      severity: "warning",
      title: "Section 8-A has a backlog of missing work",
      pattern: "Several students in 8-A have missed most assignments due in the last 4 weeks.",
      evidence: [{ label: "Missing rate", value: 62, unit: "%" }],
      date_from: "2026-09-01",
      date_to: "2026-10-01",
      confidence: 0.6,
      reviewer_role: "principal",
      recommended_actions: ["Review the section's submission log with the class teacher."],
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("insight.explain (M19-T17)", () => {
  it("principal explains an open insight -> explanation + provider/model stored, status unchanged", async () => {
    const inst = await createTestInstitution("insight-explain-ok");
    try {
      const id = await insertInsight(inst.institutionId);
      runStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { data: VALID_EXPLANATION, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      const result = await callAs(inst, "principal", explainInsight, { insightId: id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({
        insightId: id,
        explanation: VALID_EXPLANATION,
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        fallback: false,
      });

      const [row] = await sql`
        select status, explanation, explanation_provider, explanation_model
        from public.insights where id = ${id}::uuid
      `;
      expect(row.status).toBe("new");
      expect(row.explanation).toEqual(VALID_EXPLANATION);
      expect(row.explanation_provider).toBe("local");
      expect(row.explanation_model).toBe("qwen3:4b-instruct-2507-q4_K_M");
    } finally {
      await inst.cleanup();
    }
  });

  it("the captured prompt has no UUID, no fixture student name, and both nonce markers", async () => {
    const inst = await createTestInstitution("insight-explain-prompt");
    try {
      const [student] = await sql`
        insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Zephyrine', 'Oyelaran', '2015-01-01', 'other')
        returning id
      `;
      const id = await insertInsight(inst.institutionId, {
        entity_type: "student",
        entity_id: student.id as string,
      });
      runStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { data: VALID_EXPLANATION, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      const result = await callAs(inst, "principal", explainInsight, { insightId: id });
      expect(result.ok).toBe(true);

      expect(runStructuredMock).toHaveBeenCalledTimes(1);
      const prompt = runStructuredMock.mock.calls[0][0].prompt as string;
      expect(prompt).not.toMatch(UUID_PATTERN);
      expect(prompt).not.toContain("Zephyrine");
      expect(prompt).not.toContain("Oyelaran");
      const markers = [...prompt.matchAll(INSIGHT_EXPLAIN_DATA_BLOCK_MARKER_PATTERN)];
      expect(markers).toHaveLength(2);
      expect(markers[0][2]).toBe(markers[1][2]); // same nonce, start + end
    } finally {
      await inst.cleanup();
    }
  });

  it("ai_unavailable is passed through; the row is left unchanged", async () => {
    const inst = await createTestInstitution("insight-explain-unavailable");
    try {
      const id = await insertInsight(inst.institutionId);
      runStructuredMock.mockResolvedValueOnce({
        ok: false,
        error: { code: "ai_unavailable", message: "Local AI engine is not reachable (policy: local_only)." },
      });

      const result = await callAs(inst, "principal", explainInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ai_unavailable");

      const [row] = await sql`select explanation, explained_at from public.insights where id = ${id}::uuid`;
      expect(row.explanation).toBeNull();
      expect(row.explained_at).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a dismissed insight -> invalid_state, no gateway call", async () => {
    const inst = await createTestInstitution("insight-explain-dismissed");
    try {
      const id = await insertInsight(inst.institutionId, { status: "dismissed" });
      const result = await callAs(inst, "principal", explainInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant -> forbidden (no ai.generate), no gateway call", async () => {
    const inst = await createTestInstitution("insight-explain-accountant");
    try {
      const id = await insertInsight(inst.institutionId, { domain: "finance", reviewer_role: "accountant" });
      const result = await callAs(inst, "accountant", explainInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher on another section's insight -> not_found", async () => {
    const inst = await createTestInstitution("insight-explain-teacher-other");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const otherSectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "Z" });
      const id = await insertInsight(inst.institutionId, {
        domain: "attendance",
        reviewer_role: "principal",
        class_section_id: otherSectionId,
      });

      const result = await callAs(inst, "teacher", explainInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });
});
