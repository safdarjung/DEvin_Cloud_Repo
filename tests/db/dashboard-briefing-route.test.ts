// M25-T7 — exercises the real exported `POST` handler of
// `src/app/api/ai/dashboard-briefing/route.ts` against the live Supabase
// instance (gateway mocked, request pattern from `tests/db/quiz-route.test.ts`).
// Only `@/lib/supabase/server` (real signed-in client, no Next
// request-scoped `cookies()`) and `@/lib/ai/gateway` (packet rule: "with
// the gateway mocked") are mocked; everything else — `getTenantContext`,
// `requirePermission`, `ensureBriefing`/`setBriefingHeadline` (real
// service-role write) — is the real module graph and real RLS.
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
import { BRIEFING_DATA_BLOCK_MARKER_PATTERN } from "@/modules/ai/prompts/dashboard-briefing";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const runStructuredMock = runStructured as unknown as ReturnType<typeof vi.fn>;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function actingAs(fixture: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0]): void {
  currentClient = fixture.clientAs(role);
}

function briefingRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/dashboard-briefing", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function bodyFor(slug: string) {
  return { institutionSlug: slug, openEnquiries: 0, enrolledCount: 0, collections: null };
}

async function latestBriefingRow(institutionId: string, role: string) {
  const [row] = await sql`
    select headline, provider from public.briefings
    where institution_id = ${institutionId} and role = ${role}
    order by brief_date desc limit 1
  `;
  return row as { headline: string; provider: string | null } | undefined;
}

describe("POST /api/ai/dashboard-briefing (M25-T7)", () => {
  it("principal: 200 with the narrated headline, row provider local, generated_by local_model; prompt has both nonce markers, no UUID, no fixture name", async () => {
    const inst = await createTestInstitution("briefing-route-principal");
    try {
      runStructuredMock.mockResolvedValue({
        ok: true,
        data: { data: { headline: "Steady day ahead." }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const res = await POST(briefingRequest(bodyFor(inst.slug)));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.summary).toBe("Steady day ahead.");
      expect(body.data.provider).toBe("local");
      expect(body.data.brief.generated_by).toBe("local_model");
      expect(body.data.brief.role).toBe("principal");

      expect(runStructuredMock).toHaveBeenCalledTimes(1);
      const call = runStructuredMock.mock.calls[0][0];
      const markers = call.prompt.match(BRIEFING_DATA_BLOCK_MARKER_PATTERN) ?? [];
      expect(markers).toHaveLength(2);
      expect(call.prompt).not.toMatch(UUID_RE);
      expect(call.prompt).not.toContain("Test ");

      const row = await latestBriefingRow(inst.institutionId, "principal");
      expect(row?.provider).toBe("local");
    } finally {
      await inst.cleanup();
    }
  });

  it("owner reads the same already-narrated row next: 200 with the same summary, model null, gateway not called again", async () => {
    const inst = await createTestInstitution("briefing-route-owner-reads");
    try {
      runStructuredMock.mockResolvedValue({
        ok: true,
        data: { data: { headline: "Narrated once." }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const first = await POST(briefingRequest(bodyFor(inst.slug)));
      expect(first.status).toBe(200);
      expect(runStructuredMock).toHaveBeenCalledTimes(1);

      actingAs(inst, "owner");
      const second = await POST(briefingRequest(bodyFor(inst.slug)));
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body.data.summary).toBe("Narrated once.");
      expect(body.data.model).toBeNull();
      expect(runStructuredMock).toHaveBeenCalledTimes(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("gateway ai_unavailable: 502; the row persists with the rules headline; a later call narrates it", async () => {
    const inst = await createTestInstitution("briefing-route-gateway-fail");
    try {
      runStructuredMock.mockResolvedValueOnce({ ok: false, error: { code: "ai_unavailable", message: "AI is currently unavailable." } });

      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const first = await POST(briefingRequest(bodyFor(inst.slug)));
      expect(first.status).toBe(502);
      const firstBody = await first.json();
      expect(firstBody.error.code).toBe("ai_unavailable");

      const row = await latestBriefingRow(inst.institutionId, "principal");
      expect(row?.provider).toBeNull();
      expect(row?.headline).toMatch(/^Principal briefing/);

      runStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { data: { headline: "Caught up now." }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });
      const second = await POST(briefingRequest(bodyFor(inst.slug)));
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.data.summary).toBe("Caught up now.");

      const rowAfter = await latestBriefingRow(inst.institutionId, "principal");
      expect(rowAfter?.provider).toBe("local");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant: 403 and no briefings row created", async () => {
    const inst = await createTestInstitution("briefing-route-accountant");
    try {
      actingAs(inst, "accountant");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const res = await POST(briefingRequest(bodyFor(inst.slug)));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
      expect(runStructuredMock).not.toHaveBeenCalled();

      const row = await latestBriefingRow(inst.institutionId, "accountant");
      expect(row).toBeUndefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: 200 with the teacher brief", async () => {
    const inst = await createTestInstitution("briefing-route-teacher");
    try {
      runStructuredMock.mockResolvedValue({
        ok: true,
        data: { data: { headline: "Teacher day ahead." }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
      });

      actingAs(inst, "teacher");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const res = await POST(briefingRequest(bodyFor(inst.slug)));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.brief.role).toBe("teacher");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: 403 (no insight.read; no brief role)", async () => {
    const inst = await createTestInstitution("briefing-route-guardian");
    try {
      actingAs(inst, "guardian");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const res = await POST(briefingRequest(bodyFor(inst.slug)));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-site Origin -> 403 forbidden, before any context resolution", async () => {
    const inst = await createTestInstitution("briefing-route-cross-site");
    try {
      actingAs(inst, "principal");
      const { POST } = await import("@/app/api/ai/dashboard-briefing/route");
      const res = await POST(briefingRequest(bodyFor(inst.slug), { origin: "https://evil.example" }));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
      expect(runStructuredMock).not.toHaveBeenCalled();
    } finally {
      await inst.cleanup();
    }
  });
});
