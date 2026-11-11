// features-18 §D — POST /api/ai/lab-explain against live Supabase with the
// gateway mocked (tests/db/dashboard-briefing-route.test.ts pattern). The
// numbers are re-read through lab.queries under the caller's RLS; this
// file checks the prompt carries only name-free aggregates, the digit
// post-check falls back to deterministic captions, and the gates hold.
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

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
import { LAB_DATA_BLOCK_MARKER_PATTERN } from "@/modules/fabric/lab.prompts";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const runStructuredMock = runStructured as unknown as ReturnType<typeof vi.fn>;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

beforeEach(() => {
  runStructuredMock.mockReset();
});

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actingAs(fixture: TestInstitution, role: FixtureRole): void {
  currentClient = fixture.clientAs(role) as unknown as SupabaseClient<Database>;
}

function explainRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/lab-explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Grade VI-A with 6 enrolled students. Returns the section id. */
async function seedSection(inst: TestInstitution): Promise<string> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);
  for (let i = 0; i < 6; i++) {
    const [student] = await sql`
      insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${inst.institutionId}, ${`LABX-${i}-${crypto.randomUUID().slice(0, 6)}`}, ${`Zubeida${i}`}, '2014-01-01', 'other')
      returning id
    `;
    await createEnrolment(inst.institutionId, student.id as string, sectionId, yearId, { rollNo: i + 1 });
  }
  return sectionId;
}

function aiOutput(bullets: string[], caveat = "A pattern in averages is not a cause.") {
  return { ok: true, data: { data: { bullets, caveat }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false } };
}

describe("POST /api/ai/lab-explain", () => {
  it("principal fee_risk: AI bullets returned; prompt is nonce-delimited, name-free, id-free; owner cloud exception; output capped", async () => {
    const inst = await createTestInstitution("lab-explain-principal");
    try {
      await seedSection(inst);
      runStructuredMock.mockResolvedValue(aiOutput(["Grade VI has 6 students and none of its 0 invoices are overdue."]));

      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/lab-explain/route");
      const res = await POST(explainRequest({ institutionSlug: inst.slug, kind: "fee_risk", ref: null }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({ source: "ai", provider: "local", bullets: ["Grade VI has 6 students and none of its 0 invoices are overdue."] });

      expect(runStructuredMock).toHaveBeenCalledTimes(1);
      const call = runStructuredMock.mock.calls[0][0];
      expect(call.feature).toBe("lab_explain");
      expect(call.agentCloud).toBe(true);
      expect(call.maxOutputTokens).toBe(1024);
      expect(call.prompt.match(LAB_DATA_BLOCK_MARKER_PATTERN)).toHaveLength(2);
      expect(call.prompt).toContain('"grade":"Grade VI"');
      expect(call.prompt).not.toMatch(UUID_RE);
      expect(call.prompt).not.toContain("Zubeida");
    } finally {
      await inst.cleanup();
    }
  });

  it("an AI number not in the input falls back to the deterministic captions", async () => {
    const inst = await createTestInstitution("lab-explain-digits");
    try {
      await seedSection(inst);
      runStructuredMock.mockResolvedValue(aiOutput(["Overdue invoices rose 42% this term."]));

      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/lab-explain/route");
      const res = await POST(explainRequest({ institutionSlug: inst.slug, kind: "fee_risk", ref: null }));

      const body = await res.json();
      expect(body.data).toMatchObject({
        source: "rules",
        provider: null,
        bullets: ["Grade VI, no attendance yet (6 students): no overdue invoices."],
      });
    } finally {
      await inst.cleanup();
    }
  });

  it("section kind: a visible section is explained; an unknown section id is not_found without calling the model", async () => {
    const inst = await createTestInstitution("lab-explain-section");
    try {
      const sectionId = await seedSection(inst);
      runStructuredMock.mockResolvedValue(aiOutput(["Grade VI-A has 6 students."]));
      actingAs(inst, "owner");
      const { POST } = await import("@/app/api/ai/lab-explain/route");

      const found = await POST(explainRequest({ institutionSlug: inst.slug, kind: "section", ref: sectionId }));
      expect(found.status).toBe(200);
      expect(runStructuredMock).toHaveBeenCalledTimes(1);

      const missing = await POST(explainRequest({ institutionSlug: inst.slug, kind: "section", ref: crypto.randomUUID() }));
      expect(missing.status).toBe(404);
      expect(runStructuredMock).toHaveBeenCalledTimes(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("no group large enough: deterministic 'nothing to explain', model not called", async () => {
    const inst = await createTestInstitution("lab-explain-empty");
    try {
      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/lab-explain/route");
      const res = await POST(explainRequest({ institutionSlug: inst.slug, kind: "correlation", ref: null }));
      expect(res.status).toBe(200);
      expect((await res.json()).data.source).toBe("rules");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher and guardian: forbidden; client-sent numbers: validation_failed; model never called", async () => {
    const inst = await createTestInstitution("lab-explain-denied");
    try {
      const { POST } = await import("@/app/api/ai/lab-explain/route");
      for (const role of ["teacher", "guardian"] as const) {
        actingAs(inst, role);
        const res = await POST(explainRequest({ institutionSlug: inst.slug, kind: "anomalies", ref: null }));
        expect(res.status).toBe(403);
      }
      actingAs(inst, "principal");
      const extra = await POST(explainRequest({ institutionSlug: inst.slug, kind: "anomalies", ref: null, data: [{ z: 9 }] }));
      expect(extra.status).toBe(422);
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });
});
