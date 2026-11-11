// features-18 §D — POST /api/ai/lab-scenario with the REAL gateway
// (runStructured) and mocked model/provider factories (tests/unit/ai-gateway.test.ts
// mocks). Proves: the route runs on Groq under the owner cloud exception
// (aggregate text only), a role whose cloud switch is off never builds a cloud
// provider, model output is clamped to slider ranges, and permission/capability
// gates hold.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});

vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(() => "local-model-handle"),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
  getGeminiModel: vi.fn(async () => "gemini-model-handle"),
  geminiModelId: vi.fn(() => "gemini-flash-lite-latest"),
  getGroqModel: vi.fn(async () => "groq-model-handle"),
  groqModelId: vi.fn(() => "openai/gpt-oss-120b"),
}));

vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: vi.fn(async () => {}),
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({ daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4 })),
}));

const getTenantContextMock = vi.fn();
vi.mock("@/lib/auth/context", () => ({ getTenantContext: (...args: unknown[]) => getTenantContextMock(...args) }));

const providers = await import("@/lib/ai/providers");
const { POST } = await import("@/app/api/ai/lab-scenario/route");
const { LAB_DATA_BLOCK_MARKER_PATTERN } = await import("@/modules/fabric/lab.prompts");

function fakeCtx(role: Role, aiPolicy: TenantContext["institution"]["ai_policy"] = "local_only", settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings, ai_policy: aiPolicy, is_demo: false },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/lab-scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MODEL_OUTPUT = {
  enrolment_delta_pct: 45, // above the 30 max
  staff_delta: 2.4,
  fee_change_pct: 8,
  cost_change_pct: null,
  periods_per_day: null,
  horizon_months: 36, // above the 24 max
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_CLOUD_ENABLED = "true";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/ai/lab-scenario", () => {
  it("local_only principal with cloud keys: runs on Gemini first (owner cloud exception), never local or Anthropic", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("principal"));
    generateTextMock.mockResolvedValueOnce({ output: MODEL_OUTPUT, usage: { inputTokens: 10, outputTokens: 20 } });

    const res = await POST(request({ institutionSlug: "demo", text: "fees up 8% over 3 years" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ provider: "cloud", model: "gemini-flash-lite-latest" });
    expect(generateTextMock.mock.calls[0][0].model).toBe("gemini-model-handle");
    expect(providers.getLocalModel).not.toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("principal whose role cloud switch is off: runs on the local model only, never builds a cloud provider, returns clamped assumptions", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("principal", "local_only", { ai_roles: { principal: { cloud: false } } }));
    generateTextMock.mockResolvedValueOnce({ output: MODEL_OUTPUT, usage: { inputTokens: 10, outputTokens: 20 } });

    const res = await POST(request({ institutionSlug: "demo", text: "45% more students, two more teachers, fees up 8% over 3 years" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        assumptions: { enrolment_delta_pct: 30, staff_delta: 2, fee_change_pct: 8, horizon_months: 24 },
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
      },
    });
    expect(providers.getLocalModel).toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
    expect(providers.getGroqModel).not.toHaveBeenCalled();
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
    const call = generateTextMock.mock.calls[0][0];
    expect(call.maxOutputTokens).toBe(512);
    expect(JSON.stringify(call.prompt).match(LAB_DATA_BLOCK_MARKER_PATTERN)).toHaveLength(2);
  });

  it("teacher (no scenario.manage): forbidden, model never called", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    const res = await POST(request({ institutionSlug: "demo", text: "fees up 5%" }));
    expect(res.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("capability turned off for the role: ai_unavailable, model never called", async () => {
    const ctx = fakeCtx("owner");
    getTenantContextMock.mockResolvedValue({
      ...ctx,
      institution: { ...ctx.institution, settings: { ai_roles: { owner: { capabilities: { lab_scenario: false } } } } },
    });
    const res = await POST(request({ institutionSlug: "demo", text: "fees up 5%" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("over-long text or extra fields: validation_failed before any tenant lookup", async () => {
    const tooLong = await POST(request({ institutionSlug: "demo", text: "x".repeat(501) }));
    const extra = await POST(request({ institutionSlug: "demo", text: "fees up", assumptions: { fee_change_pct: 99 } }));
    expect(tooLong.status).toBe(422);
    expect(extra.status).toBe(422);
    expect(getTenantContextMock).not.toHaveBeenCalled();
  });
});
