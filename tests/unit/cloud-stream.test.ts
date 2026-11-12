// M24-T3 — src/modules/ai/agent/cloud-stream.ts: the D28/D29 cloud stream
// extracted from the teacher route (checkLimits → concurrency slot →
// model factory → streamText → usage logging → slot release). Mirrors
// tests/unit/teacher-agent-route.test.ts's mock pattern, one level down.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";
import type { LimitsResult } from "@/lib/ai/usage";

const checkLimitsMock = vi.fn(async (): Promise<LimitsResult> => ({ ok: true }));
const logUsageMock = vi.fn(async () => {});
const acquireConcurrencySlotMock = vi.fn(() => true);
const releaseConcurrencySlotMock = vi.fn();
const aiSettingsForMock = vi.fn(() => ({
  daily_token_quota: 200000,
  per_user_per_minute: 10,
  max_concurrent_local: 2,
  max_concurrent_cloud: 4,
}));
const getGeminiModelMock = vi.fn(async () => "gemini-model-handle");
const getGroqModelMock = vi.fn(async () => "groq-model-handle");
const getZaiModelMock = vi.fn(async () => "zai-model-handle");
const streamTextMock = vi.fn();

vi.mock("@/lib/ai/usage", () => ({
  checkLimits: checkLimitsMock,
  logUsage: logUsageMock,
  acquireConcurrencySlot: acquireConcurrencySlotMock,
  releaseConcurrencySlot: releaseConcurrencySlotMock,
  aiSettingsFor: aiSettingsForMock,
}));
vi.mock("@/lib/ai/providers", () => ({
  getGeminiModel: getGeminiModelMock,
  geminiModelId: () => "gemini-flash-lite-latest",
  getGroqModel: getGroqModelMock,
  groqModelId: () => "openai/gpt-oss-120b",
  getZaiModel: getZaiModelMock,
  zaiModelId: () => "glm-4.7-flash",
}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) };
});

const { streamCloudAgent } = await import("@/lib/ai/cloud-stream");

function ctx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Teacher", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.generate"]),
  } as unknown as TenantContext;
}

function baseInput(overrides: Partial<Parameters<typeof streamCloudAgent>[0]> = {}) {
  return {
    ctx: ctx(),
    feature: "teacher_agent",
    provider: "groq" as const,
    system: "system prompt",
    messages: [],
    tools: {},
    abortSignal: new AbortController().signal,
    notConfiguredMessage: "The teacher assistant is not configured. Contact your administrator.",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  checkLimitsMock.mockResolvedValue({ ok: true });
  acquireConcurrencySlotMock.mockReturnValue(true);
  getGeminiModelMock.mockResolvedValue("gemini-model-handle");
  getGroqModelMock.mockResolvedValue("groq-model-handle");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("streamCloudAgent", () => {
  it("passes feature and redactions through to checkLimits/logUsage on a quota failure", async () => {
    checkLimitsMock.mockResolvedValueOnce({ ok: false, code: "quota_exceeded" });
    const result = await streamCloudAgent(baseInput({ feature: "assistant", redactions: 3 }));
    expect(checkLimitsMock).toHaveBeenCalledWith(expect.anything(), "assistant");
    expect(result).toEqual({ ok: false, error: { code: "quota_exceeded", message: expect.stringMatching(/AI limit is used up/i) } });
    expect(logUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "assistant", ok: false, errorCode: "quota_exceeded", redactions: 3 }),
    );
    expect(acquireConcurrencySlotMock).not.toHaveBeenCalled();
  });

  it("maps a thrown checkLimits error to dependency_failed", async () => {
    checkLimitsMock.mockRejectedValueOnce(new Error("db down"));
    const result = await streamCloudAgent(baseInput());
    expect(result).toEqual({ ok: false, error: { code: "dependency_failed", message: expect.any(String) } });
    expect(logUsageMock).not.toHaveBeenCalled();
  });

  it("returns rate_limited when the concurrency slot is unavailable", async () => {
    acquireConcurrencySlotMock.mockReturnValueOnce(false);
    const result = await streamCloudAgent(baseInput());
    expect(result).toEqual({ ok: false, error: { code: "rate_limited", message: expect.any(String) } });
  });

  it("returns ai_unavailable with the given notConfiguredMessage and releases the slot on a missing provider key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    getGroqModelMock.mockRejectedValueOnce(new Error("GROQ_API_KEY is not configured."));
    const result = await streamCloudAgent(baseInput({ notConfiguredMessage: "custom message" }));
    expect(result).toEqual({ ok: false, error: { code: "ai_unavailable", message: "custom message" } });
    expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:groq", "cloud");
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ ok: false, errorCode: "ai_unavailable" }));
  });

  it("streams through the gemini model with the D28/D29 loop bounds and returns the modelId", async () => {
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    const req = new AbortController();
    const result = await streamCloudAgent(baseInput({ provider: "gemini", abortSignal: req.signal }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.modelId).toBe("gemini-flash-lite-latest");
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-model-handle",
        maxOutputTokens: 1024,
        toolCallConcurrency: 1,
        abortSignal: req.signal,
      }),
    );
    expect(result.stream.toUIMessageStreamResponse()).toBe(streamResponse);
    await vi.waitFor(() => expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:gemini", "cloud"));
    expect(logUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, inputTokens: 10, outputTokens: 5, redactions: 0 }),
    );
  });

  it("logs accumulated step usage with redactions when the stream fails mid-turn", async () => {
    streamTextMock.mockImplementationOnce((opts: { onStepFinish?: (step: unknown) => void }) => {
      opts.onStepFinish?.({ usage: { inputTokens: 7, outputTokens: 3 } });
      return {
        totalUsage: Promise.reject(new Error("stream aborted")),
        toUIMessageStreamResponse: () => new Response("stream"),
      };
    });
    await streamCloudAgent(baseInput({ redactions: 2 }));
    await vi.waitFor(() =>
      expect(logUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, inputTokens: 7, outputTokens: 3, errorCode: "ai_unavailable", redactions: 2 }),
      ),
    );
  });

  describe("with a Z.ai key", () => {
    function streamed() {
      streamTextMock.mockReturnValueOnce({ totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), toUIMessageStreamResponse: () => new Response("") });
      return vi.spyOn(console, "info").mockImplementation(() => {});
    }
    const budgetLog = (spy: ReturnType<typeof streamed>) => spy.mock.calls.find(([tag]) => tag === "[ai-budget]")?.[1];

    function keys(groq: boolean, gemini: boolean) {
      vi.stubEnv("ZAI_API_KEY", "test-key");
      vi.stubEnv("GROQ_API_KEY", groq ? "test-key" : "");
      vi.stubEnv("GEMINI_API_KEY", gemini ? "test-key" : "");
    }

    it("Gemini answers first whatever the routing pick, with Groq as the retry for a request that fits Groq", async () => {
      keys(true, true);
      const info = streamed();
      const result = await streamCloudAgent(baseInput({ provider: "groq" }));
      expect(result).toMatchObject({ ok: true, modelId: "gemini-flash-lite-latest" });
      expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-model-handle" }));
      expect(budgetLog(info)).toMatchObject({ provider: "gemini", fallback: "groq" });
      await vi.waitFor(() => expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ ok: true, model: "gemini-flash-lite-latest" })));
    });

    it("a request above Groq's ceiling is budgeted to Gemini's own ceiling and retries on Z.ai, never Groq", async () => {
      keys(true, true);
      const info = streamed();
      const result = await streamCloudAgent(baseInput({ system: "s".repeat(30_000) }));
      // 30,000 chars = 7,500 tokens: above Groq's 5,500, sent whole under Gemini's 24,000.
      expect(result.ok && result.estimatedTokens).toBeGreaterThanOrEqual(7_500);
      expect(budgetLog(info)).toMatchObject({ provider: "gemini", fallback: "zai" });
    });

    it("no Gemini key: Groq answers with Z.ai as its backup", async () => {
      keys(true, false);
      const info = streamed();
      const result = await streamCloudAgent(baseInput());
      expect(result).toMatchObject({ ok: true });
      expect(budgetLog(info)).toMatchObject({ provider: "groq", fallback: "zai" });
    });
  });
});
