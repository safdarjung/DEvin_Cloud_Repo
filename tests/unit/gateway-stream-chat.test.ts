// T3a (ai-roles) — streamChat: the single gateway entry point a future
// caller (T4's handleAiChat) uses instead of calling streamAgent /
// streamCloudAgent directly. mode "local" delegates to streamAgent
// unchanged (never touches a cloud provider factory); mode "cloud"
// delegates to streamCloudAgent with every tool's `execute` result
// redacted first (07 §5) — a cloud step has a safe point to redact from
// (each tool result), unlike streamAgent's own whole-transcript stream.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { StreamChatInput } from "@/lib/ai/gateway";

const streamTextMock = vi.fn();
const streamCloudAgentMock = vi.fn();

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) };
});

vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(() => "local-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
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
  aiSettingsFor: vi.fn(() => ({
    daily_token_quota: 200000,
    per_user_per_minute: 10,
    max_concurrent_local: 2,
    max_concurrent_cloud: 4,
  })),
}));

vi.mock("@/lib/ai/cloud-stream", () => ({ streamCloudAgent: streamCloudAgentMock }));

const { streamChat } = await import("@/lib/ai/gateway");
const providers = await import("@/lib/ai/providers");

function fakeCtx(role: Role = "teacher"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function baseInput(overrides: Record<string, unknown> = {}): StreamChatInput<ToolSet> {
  return {
    ctx: fakeCtx(),
    feature: "assistant",
    permission: "ai.generate" as const,
    dataClass: "general" as const,
    system: "You help.",
    messages: [],
    tools: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  } as unknown as StreamChatInput<ToolSet>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("streamChat", () => {
  it("mode local never builds a cloud provider and never calls streamCloudAgent", async () => {
    streamTextMock.mockReturnValueOnce({ totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }) });

    const result = await streamChat(baseInput({ mode: "local" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("local");
    expect(providers.getCloudModel).not.toHaveBeenCalled();
    expect(providers.getGroqModel).not.toHaveBeenCalled();
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
    expect(streamCloudAgentMock).not.toHaveBeenCalled();
  });

  it("forbids a role without the caller-named permission, for either mode", async () => {
    const result = await streamChat(baseInput({ mode: "local", ctx: fakeCtx("accountant") }));

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: "You do not have permission to use AI features." } });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(streamCloudAgentMock).not.toHaveBeenCalled();
  });

  it("mode cloud wraps every tool's execute result through redact() before streamCloudAgent sees it", async () => {
    streamCloudAgentMock.mockImplementationOnce(async (input: { tools: Record<string, { execute: (a: unknown) => Promise<unknown> }> }) => {
      const out = await input.tools.lookupStudent.execute({});
      return { ok: true, modelId: "openai/gpt-oss-120b", stream: { text: Promise.resolve(out) } };
    });

    const result = await streamChat(
      baseInput({
        mode: "cloud",
        provider: "groq",
        notConfiguredMessage: "not configured",
        tools: {
          lookupStudent: {
            description: "look up a student",
            inputSchema: {},
            execute: async () => ({ email: "guardian@example.com", name: "Aarav Sharma" }),
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.provider).toBe("cloud");
    const redactedOut = await (result.stream as unknown as { text: Promise<unknown> }).text;
    // Shape is kept (the UI renders structured tool output); string leaves are redacted.
    expect(redactedOut).toEqual({ email: "[REDACTED_EMAIL]", name: "Aarav Sharma" });
  });

  it("mode cloud folds the tool-result redaction count into the redactions passed to streamCloudAgent", async () => {
    let capturedRedactions: (() => number) | number | undefined;
    streamCloudAgentMock.mockImplementationOnce(async (input: { redactions?: number | (() => number); tools: Record<string, { execute: (a: unknown) => Promise<unknown> }> }) => {
      await input.tools.lookupStudent.execute({});
      capturedRedactions = input.redactions;
      return { ok: true, modelId: "openai/gpt-oss-120b", stream: { text: Promise.resolve("") } };
    });

    await streamChat(
      baseInput({
        mode: "cloud",
        provider: "groq",
        notConfiguredMessage: "not configured",
        redactions: 1, // e.g. the user's own message text was already redacted by the caller
        tools: {
          lookupStudent: { description: "x", inputSchema: {}, execute: async () => "contact guardian@example.com" },
        },
      }),
    );

    expect(typeof capturedRedactions).toBe("function");
    expect((capturedRedactions as () => number)()).toBe(2); // 1 from the caller + 1 found in the tool result
  });

  it("mode cloud returns ai_unavailable, without calling streamCloudAgent, when no provider is given", async () => {
    const result = await streamChat(baseInput({ mode: "cloud" }));

    expect(result).toEqual({ ok: false, error: { code: "ai_unavailable", message: expect.any(String) } });
    expect(streamCloudAgentMock).not.toHaveBeenCalled();
  });

  it("mode cloud passes the result through when streamCloudAgent fails", async () => {
    streamCloudAgentMock.mockResolvedValueOnce({ ok: false, error: { code: "ai_unavailable", message: "not configured" } });

    const result = await streamChat(baseInput({ mode: "cloud", provider: "gemini", notConfiguredMessage: "not configured" }));

    expect(result).toEqual({ ok: false, error: { code: "ai_unavailable", message: "not configured" } });
  });
});
