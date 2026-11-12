import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APICallError, NoObjectGeneratedError } from "ai";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

const generateTextMock = vi.fn();
const streamTextMock = vi.fn();

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    streamText: (...args: unknown[]) => streamTextMock(...args),
  };
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
  getZaiModel: vi.fn(async () => "zai-model-handle"),
  zaiModelId: vi.fn(() => "glm-4.7-flash"),
}));

vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: vi.fn(async () => {}),
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({
    daily_token_quota: 200000,
    per_user_per_minute: 10,
    max_concurrent_local: 2,
    max_concurrent_cloud: 4,
  })),
}));

const { runStructured, streamAgent } = await import("@/lib/ai/gateway");
const providers = await import("@/lib/ai/providers");
const usage = await import("@/lib/ai/usage");

function fakeCtx(aiPolicy: TenantContext["institution"]["ai_policy"], role: Role = "teacher"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: aiPolicy, is_demo: true },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const schema = z.object({ title: z.string() });
const baseInput = { feature: "quiz", schema, instructions: "generate a quiz", prompt: "unit on photosynthesis" };

function usageResult() {
  return {
    output: { title: "Photosynthesis quiz" },
    usage: { inputTokens: 10, outputTokens: 20 },
  };
}

function schemaError(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "invalid json",
    text: "not json",
    // Shapes are irrelevant to isInstance(); fields are unused by the gateway.
    response: {} as never,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
    finishReason: "stop" as never,
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usage.checkLimits).mockResolvedValue({ ok: true });
  vi.mocked(usage.acquireConcurrencySlot).mockReturnValue(true);
  delete process.env.AI_CLOUD_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("runStructured", () => {
  it("local_only succeeds via local and never touches the cloud factory (C-62)", async () => {
    generateTextMock.mockResolvedValueOnce(usageResult());

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(result).toEqual({
      ok: true,
      data: { data: { title: "Photosynthesis quiz" }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
    });
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("local_with_cloud_fallback without a cloud key returns ai_unavailable, no cloud call (C-63)", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await runStructured({ ctx: fakeCtx("local_with_cloud_fallback"), ...baseInput });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ai_unavailable");
    expect(providers.getCloudModel).not.toHaveBeenCalled();
    expect(usage.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, errorCode: "ai_unavailable", provider: "local" }),
    );
  });

  it("agentCloud + only GROQ_API_KEY: a local_only school runs on Groq with Groq's options", async () => {
    process.env.GROQ_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, agentCloud: true });
    expect(result).toMatchObject({ ok: true, data: { provider: "cloud", model: "openai/gpt-oss-120b" } });
    expect(generateTextMock.mock.calls[0][0]).toMatchObject({
      model: "groq-model-handle",
      providerOptions: { groq: { reasoningEffort: "low", strictJsonSchema: false } },
    });
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
    expect(providers.getLocalModel).not.toHaveBeenCalled();
  });

  it("agentCloud + all three keys: Gemini answers first, Groq's options ride along for its retry, usage names the Gemini model", async () => {
    process.env.ZAI_API_KEY = "test-key";
    process.env.GROQ_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, maxOutputTokens: 500, agentCloud: true });
    expect(result).toMatchObject({ ok: true, data: { provider: "cloud", model: "gemini-flash-lite-latest" } });
    expect(generateTextMock.mock.calls[0][0]).toMatchObject({
      model: "gemini-model-handle",
      maxOutputTokens: 1024,
      providerOptions: { groq: { reasoningEffort: "low", strictJsonSchema: false } },
    });
    expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ ok: true, provider: "cloud", model: "gemini-flash-lite-latest" }));
    expect(providers.getZaiModel).not.toHaveBeenCalled();
    expect(providers.getLocalModel).not.toHaveBeenCalled();
  });

  it("agentCloud + only GEMINI_API_KEY: a local_only school runs on Gemini, redacted, never local or Anthropic", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const result = await runStructured({
      ctx: fakeCtx("local_only"),
      ...baseInput,
      prompt: "Remark for Aarav Sharma",
      denyNames: ["Aarav Sharma"],
      agentCloud: true,
    });
    expect(result).toMatchObject({ ok: true, data: { provider: "cloud", model: "gemini-flash-lite-latest", fallback: false } });
    expect(generateTextMock.mock.calls[0][0]).toMatchObject({ model: "gemini-model-handle" });
    expect(JSON.stringify(generateTextMock.mock.calls[0][0].prompt)).not.toContain("Aarav Sharma");
    expect(providers.getLocalModel).not.toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("agentCloud without a Groq/Gemini key keeps the policy plan (local_only -> local)", async () => {
    generateTextMock.mockResolvedValueOnce(usageResult());
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, agentCloud: true });
    expect(result).toMatchObject({ ok: true, data: { provider: "local" } });
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
  });

  it("agentCloud with the role's cloud switch off (D50) keeps the policy plan: local, no cloud provider built", async () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.ZAI_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const base = fakeCtx("local_only");
    const ctx = { ...base, institution: { ...base.institution, settings: { ai_roles: { teacher: { cloud: false } } } } };
    const result = await runStructured({ ctx, ...baseInput, agentCloud: true });
    expect(result).toMatchObject({ ok: true, data: { provider: "local" } });
    expect(providers.getGroqModel).not.toHaveBeenCalled();
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
    expect(providers.getZaiModel).not.toHaveBeenCalled();
  });

  it("agentCloud: a request over Groq's per-request ceiling goes to Gemini; one over every ceiling is refused unsent", async () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const big = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, prompt: "x".repeat(20_000), maxOutputTokens: 4096, agentCloud: true });
    expect(big).toMatchObject({ ok: true, data: { provider: "cloud", model: "gemini-flash-lite-latest" } });
    expect(providers.getGroqModel).not.toHaveBeenCalled();

    const huge = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, prompt: "x".repeat(100_000), agentCloud: true });
    expect(huge).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("agentCloud: a busy provider maps to rate_limited with a plain message, not a policy name", async () => {
    process.env.GROQ_API_KEY = "test-key";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateTextMock.mockRejectedValueOnce(
      new APICallError({ message: "rate limit", url: "https://x", requestBodyValues: {}, statusCode: 429, responseBody: '{"error":{"code":"rate_limit_exceeded"}}' }),
    );
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, agentCloud: true });
    expect(result).toEqual({ ok: false, error: { code: "rate_limited", message: "The AI service is busy right now. Please try again in a minute." } });
  });

  it("agentCloud: Groq's server-side json_validate_failed gets the one repair retry", async () => {
    process.env.GROQ_API_KEY = "test-key";
    generateTextMock
      .mockRejectedValueOnce(
        new APICallError({ message: "Failed to generate JSON", url: "https://x", requestBodyValues: {}, statusCode: 400, responseBody: '{"error":{"code":"json_validate_failed"}}' }),
      )
      .mockResolvedValueOnce(usageResult());
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, agentCloud: true });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[1][0].instructions).toContain("Your previous response was invalid");
    expect(result).toMatchObject({ ok: true, data: { provider: "cloud", model: "openai/gpt-oss-120b" } });
  });

  it("strictSchema: an answer breaking a rule the provider schema cannot carry is repaired once, naming the rule", async () => {
    const strictSchema = z.object({ title: z.string() }).refine((v) => v.title !== "dup", { message: "Title must be new.", path: ["title"] });
    const answer = (title: string) => ({ ...usageResult(), output: { title }, response: {}, finishReason: "stop" });
    generateTextMock.mockResolvedValueOnce(answer("dup")).mockResolvedValueOnce(answer("Fresh quiz"));
    const repaired = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, strictSchema });
    expect(repaired).toMatchObject({ ok: true, data: { data: { title: "Fresh quiz" } } });
    expect(generateTextMock.mock.calls[1][0].instructions).toContain("title: Title must be new.");

    generateTextMock.mockResolvedValueOnce(answer("dup")).mockResolvedValueOnce(answer("dup"));
    const failed = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput, strictSchema });
    expect(failed).toMatchObject({ ok: false, error: { code: "ai_invalid_output" } });
    expect(generateTextMock).toHaveBeenCalledTimes(4);
  });

  it("a caller that does not opt in stays local on local_only even with cloud keys set (C-62)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GROQ_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce(usageResult());
    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });
    expect(result).toMatchObject({ ok: true, data: { provider: "local" } });
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("returns quota_exceeded without calling a provider", async () => {
    vi.mocked(usage.checkLimits).mockResolvedValueOnce({ ok: false, code: "quota_exceeded" });

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(result).toEqual({
      ok: false,
      error: { code: "quota_exceeded", message: "Today's AI limit is used up. It resets at midnight." },
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns rate_limited without calling a provider", async () => {
    vi.mocked(usage.checkLimits).mockResolvedValueOnce({ ok: false, code: "rate_limited" });

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("rate_limited");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("retries exactly once on invalid output, then succeeds", async () => {
    generateTextMock.mockRejectedValueOnce(schemaError()).mockResolvedValueOnce(usageResult());

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      data: { data: { title: "Photosynthesis quiz" }, provider: "local", model: "qwen3:4b-instruct-2507-q4_K_M", fallback: false },
    });
  });

  it("returns ai_invalid_output when the repair retry also fails", async () => {
    generateTextMock.mockRejectedValueOnce(schemaError()).mockRejectedValueOnce(schemaError());

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ai_invalid_output");
  });

  it("forbids a role without ai.generate", async () => {
    const result = await runStructured({ ctx: fakeCtx("local_only", "accountant"), ...baseInput });

    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "You do not have permission to use AI features." },
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("local_with_cloud_fallback falls back to cloud when local fails and cloud is configured", async () => {
    process.env.AI_CLOUD_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    generateTextMock.mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValueOnce(usageResult());

    const result = await runStructured({ ctx: fakeCtx("local_with_cloud_fallback"), ...baseInput });

    expect(providers.getCloudModel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: { data: { title: "Photosynthesis quiz" }, provider: "cloud", model: "claude-sonnet-5", fallback: true },
    });
  });

  it("redacts instructions and the repair note, not just the prompt, before a cloud call", async () => {
    process.env.AI_CLOUD_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    generateTextMock.mockRejectedValueOnce(schemaError()).mockResolvedValueOnce(usageResult());

    await runStructured({
      ctx: fakeCtx("cloud_allowed"),
      ...baseInput,
      instructions: "Write feedback for Priya Sharma (9876543210).",
      prompt: "Guardian email: guardian@example.com",
      denyNames: ["Priya Sharma"],
    });

    const sent = JSON.stringify(generateTextMock.mock.calls.map(([args]) => [args.instructions, args.prompt]));
    expect(sent).not.toMatch(/Priya|9876543210|guardian@example\.com/);
    expect(vi.mocked(usage.logUsage).mock.calls.at(-1)?.[0].redactions).toBe(3);
  });

  it("returns a failure envelope instead of throwing when the quota check errors", async () => {
    vi.mocked(usage.checkLimits).mockRejectedValueOnce(new Error("connection refused"));

    const result = await runStructured({ ctx: fakeCtx("local_only"), ...baseInput });

    expect(result).toMatchObject({ ok: false, error: { code: "dependency_failed" } });
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("streamAgent (D31/D32/GU-05)", () => {
  const baseStreamInput = {
    feature: "study",
    permission: "ai.generate" as const,
    dataClass: "general" as const,
    system: "You help.",
    messages: [],
    tools: {},
    abortSignal: new AbortController().signal,
  };

  function streamResult(usagePromise: Promise<{ inputTokens: number; outputTokens: number }> = Promise.resolve({ inputTokens: 5, outputTokens: 7 })) {
    return { totalUsage: usagePromise };
  }

  it("local_only succeeds via local and never touches the cloud factory", async () => {
    streamTextMock.mockReturnValueOnce(streamResult());

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("local");
      expect(result.modelId).toBe("qwen3:4b-instruct-2507-q4_K_M");
    }
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("forbids a role without the caller-named permission", async () => {
    const result = await streamAgent({ ctx: fakeCtx("local_only", "accountant"), ...baseStreamInput });

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: "You do not have permission to use AI features." } });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("D32: student_personal is blocked before any provider call when the policy isn't local_only", async () => {
    const result = await streamAgent({ ctx: fakeCtx("cloud_allowed"), ...baseStreamInput, dataClass: "student_personal" });

    expect(result).toEqual({
      ok: false,
      error: { code: "ai_policy_blocked", message: "This feature is only available on a local-only AI policy for now." },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("D32: student_personal is blocked on local_with_cloud_fallback too, not just cloud_allowed (HIGH-1)", async () => {
    const result = await streamAgent({ ctx: fakeCtx("local_with_cloud_fallback"), ...baseStreamInput, dataClass: "student_personal" });

    expect(result).toEqual({
      ok: false,
      error: { code: "ai_policy_blocked", message: "This feature is only available on a local-only AI policy for now." },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("D32: student_personal succeeds on a local_only institution", async () => {
    streamTextMock.mockReturnValueOnce(streamResult());

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput, dataClass: "student_personal" });

    expect(result.ok).toBe(true);
  });

  it("HIGH-2: never reaches the cloud step even when cloud is fully configured and the plan is cloud-only", async () => {
    process.env.AI_CLOUD_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";

    const result = await streamAgent({ ctx: fakeCtx("cloud_allowed"), ...baseStreamInput });

    expect(result).toEqual({
      ok: false,
      error: { code: "ai_unavailable", message: "Cloud AI provider is not reachable (policy: cloud_allowed)." },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("returns quota_exceeded without calling streamText", async () => {
    vi.mocked(usage.checkLimits).mockResolvedValueOnce({ ok: false, code: "quota_exceeded" });

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });

    expect(result).toEqual({
      ok: false,
      error: { code: "quota_exceeded", message: "Today's AI limit is used up. It resets at midnight." },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("falls back to the next step if a concurrency slot can't be acquired, failing closed if none are available", async () => {
    vi.mocked(usage.acquireConcurrencySlot).mockReturnValue(false);

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ai_unavailable");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("releases the already-acquired concurrency slot when provider setup fails, before any token streams", async () => {
    vi.mocked(providers.getLocalModel).mockImplementationOnce(() => {
      throw new Error("not configured");
    });

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });

    expect(result.ok).toBe(false);
    expect(usage.releaseConcurrencySlot).toHaveBeenCalledWith("inst-1", "local");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("logs usage once the stream's total usage resolves, and releases the concurrency slot", async () => {
    streamTextMock.mockReturnValueOnce(streamResult(Promise.resolve({ inputTokens: 5, outputTokens: 7 })));

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(usage.releaseConcurrencySlot).toHaveBeenCalledWith("inst-1", "local"));

    expect(usage.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, provider: "local", inputTokens: 5, outputTokens: 7, redactions: 0 }),
    );
  });

  it("logs a failed usage event and still releases the slot when totalUsage rejects", async () => {
    streamTextMock.mockReturnValueOnce(streamResult(Promise.reject(new Error("stream failed"))));

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(usage.releaseConcurrencySlot).toHaveBeenCalledWith("inst-1", "local"));

    expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, errorCode: "ai_unavailable" }));
  });

  it("falls back to local when cloud-only policy has no cloud key configured, matching runStructured's own rule", async () => {
    streamTextMock.mockReturnValueOnce(streamResult());

    const result = await streamAgent({ ctx: fakeCtx("cloud_allowed"), ...baseStreamInput });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("local");
    expect(providers.getCloudModel).not.toHaveBeenCalled();
  });

  it("M22-T4: threads agentRunId into the success logUsage call", async () => {
    streamTextMock.mockReturnValueOnce(streamResult());

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput, agentRunId: "run-1" });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: "run-1" })));
  });

  it("M22-T4: threads agentRunId into the quota-failure logUsage call", async () => {
    vi.mocked(usage.checkLimits).mockResolvedValueOnce({ ok: false, code: "quota_exceeded" });

    await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput, agentRunId: "run-1" });

    expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: "run-1" }));
  });

  it("M22-T4: defaults agentRunId to null when not given", async () => {
    streamTextMock.mockReturnValueOnce(streamResult());

    const result = await streamAgent({ ctx: fakeCtx("local_only"), ...baseStreamInput });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: null })));
  });
});
