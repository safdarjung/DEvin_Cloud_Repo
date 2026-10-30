// T-0NN — src/app/api/ai/agent/teacher/route.ts: the cross-site guard, body
// cap, Zod validation, tenant-context error mapping, the teacher-only role
// gate, and the quota/concurrency/unavailable-model failure paths, same
// style as tests/unit/request-guards.test.ts but exercising the actual
// route handler. The success (streaming) path is covered by a mocked
// `streamText` — the real Gemini round-trip is the manual smoke test.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";
import type { LimitsResult } from "@/lib/ai/usage";

const getTenantContextMock = vi.fn();
const requirePermissionMock = vi.fn();
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
const teacherToolsMock = vi.fn(async () => ({}));
const streamTextMock = vi.fn();

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/auth/require", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require")>("@/lib/auth/require");
  return { ...actual, requirePermission: requirePermissionMock };
});
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
}));
vi.mock("@/modules/ai/agent/teacher-tools", () => ({ teacherTools: teacherToolsMock }));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) };
});

const { POST } = await import("@/app/api/ai/agent/teacher/route");

function teacherCtx(role: TenantContext["membership"]["role"] = "teacher"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Teacher", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.generate"]),
  } as unknown as TenantContext;
}

function validBody() {
  return {
    institutionSlug: "demo",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/agent/teacher", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return res.json();
}

afterEach(() => {
  vi.clearAllMocks();
  checkLimitsMock.mockResolvedValue({ ok: true });
  acquireConcurrencySlotMock.mockReturnValue(true);
  getGeminiModelMock.mockResolvedValue("gemini-model-handle");
});

describe("POST /api/ai/agent/teacher", () => {
  it("refuses a cross-site request", async () => {
    const res = await POST(request(validBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error.code).toBe("forbidden");
  });

  it("refuses a body over the byte cap via content-length", async () => {
    const res = await POST(request(validBody(), { "content-length": String(65 * 1024) }));
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects an invalid request shape", async () => {
    const res = await POST(request({ institutionSlug: "demo" }));
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe("validation_failed");
  });

  // Fix round 1 (security review, HIGH): a loose parts schema let a client
  // smuggle in a `file` part with an arbitrary https URL that the AI SDK
  // downloads server-side (~2 GiB cap) before this route's own 64 KB body
  // cap ever applies — a DoS/cost vector. The strict parts schema must
  // reject this outright, under the body-cap size, never reaching streamText.
  // Fix round 3 (live bug, D28): a real part type the HIGH fix's allowlist
  // never anticipated — "Invalid discriminator value" 422'd the moment any
  // conversation included one. Each case below is one real part type from
  // `ai` 7.0.155's UIMessagePart union; only the five with a `url`/content
  // field the SDK fetches server-side stay rejected, matching the original
  // finding exactly — everything else is allowed through, by design, so a
  // sixth unanticipated type can't repeat this bug a third time.
  for (const type of ["file", "source-url", "source-document", "reasoning-file"]) {
    it(`rejects a "${type}" part (download-capable, the original HIGH finding)`, async () => {
      const res = await POST(
        request({
          institutionSlug: "demo",
          messages: [
            { id: "m1", role: "user", parts: [{ type, url: "https://evil.example/huge.bin" }] },
          ],
        }),
      );
      expect(res.status).toBe(422);
      const body = await json(res);
      expect(body.error.code).toBe("validation_failed");
      expect(streamTextMock).not.toHaveBeenCalled();
    });
  }

  it('rejects a "data-*" part (the server never emits one; free-form client-injectable content otherwise)', async () => {
    const res = await POST(
      request({
        institutionSlug: "demo",
        messages: [{ id: "m1", role: "user", parts: [{ type: "data-anything", payload: "x" }] }],
      }),
    );
    expect(res.status).toBe(422);
  });

  it('accepts a real "reasoning" part echoed back in assistant history (the live bug)', async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    const res = await POST(
      request({
        institutionSlug: "demo",
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
          {
            id: "m2",
            role: "assistant",
            parts: [
              { type: "step-start" },
              { type: "reasoning", text: "thinking...", state: "done" },
              { type: "tool-findStudent", state: "output-available", toolCallId: "t1", input: {}, output: [] },
              { type: "step-start" },
              { type: "text", text: "Found them." },
            ],
          },
          { id: "m3", role: "user", parts: [{ type: "text", text: "and now?" }] },
        ],
      }),
    );
    expect(res).toBe(streamResponse);
  });

  it("rejects a text part over 4000 characters", async () => {
    const res = await POST(
      request({
        institutionSlug: "demo",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "a".repeat(4001) }] }],
      }),
    );
    expect(res.status).toBe(422);
  });

  // Real bug, live hosted (D28 fix round 2): useChat echoes the FULL message
  // history back on every turn, including prior assistant text parts the
  // AI SDK itself stamped with `state`/`providerMetadata` (TextUIPart's own
  // optional fields, ai 7.0.155's index.d.ts) — the second message in any
  // real conversation 422'd with "Unrecognized keys: providerMetadata,
  // state". The HIGH fix's part-TYPE allowlist (no file/data-*/reasoning)
  // was correct; `.strict()` on the text part's extra FIELDS was not.
  it("accepts a round-tripped assistant text part carrying state and providerMetadata", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    const res = await POST(
      request({
        institutionSlug: "demo",
        messages: [
          {
            id: "m1",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "Looking up the student — done.",
                state: "done",
                providerMetadata: { google: { groundingMetadata: null } },
              },
            ],
          },
          { id: "m2", role: "user", parts: [{ type: "text", text: "how many students?" }] },
        ],
      }),
    );
    expect(res).toBe(streamResponse);
  });

  it("maps a NEXT_REDIRECT tenant-context signal to unauthenticated", async () => {
    getTenantContextMock.mockRejectedValueOnce({ digest: "NEXT_REDIRECT;replace;/login" });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(401);
  });

  it("propagates a forbidden permission check", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const { AppError } = await import("@/lib/actions/result");
    requirePermissionMock.mockImplementationOnce(() => {
      throw new AppError("forbidden", "You do not have permission to use AI features.");
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
  });

  it("tells a non-teacher ai.generate role it isn't available yet", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx("admin"));
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error.message).toMatch(/not available for your role yet/);
  });

  it("returns quota_exceeded without ever acquiring a concurrency slot", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    checkLimitsMock.mockResolvedValueOnce({ ok: false, code: "quota_exceeded" });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(429);
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ ok: false, errorCode: "quota_exceeded" }));
    expect(acquireConcurrencySlotMock).not.toHaveBeenCalled();
  });

  it("returns rate_limited when the concurrency slot is unavailable", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    acquireConcurrencySlotMock.mockReturnValueOnce(false);
    const res = await POST(request(validBody()));
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body.error.code).toBe("rate_limited");
  });

  // D29 — "hi" (validBody's message) is short with no multi-part cue, so
  // pickAgentProvider routes it to groq; each provider gets its own
  // concurrency bucket (`${inst}:${provider}`) and fails closed on its own.
  it("fails closed as ai_unavailable when GROQ_API_KEY is unset, releasing the groq slot", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    getGroqModelMock.mockRejectedValueOnce(new Error("GROQ_API_KEY is not configured."));
    const res = await POST(request(validBody()));
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe("ai_unavailable");
    expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:groq", "cloud");
  });

  it("fails closed as ai_unavailable when GEMINI_API_KEY is unset, for a message routed to gemini", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    getGeminiModelMock.mockRejectedValueOnce(new Error("GEMINI_API_KEY is not configured."));
    const longBody = {
      institutionSlug: "demo",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "a".repeat(221) }] }],
    };
    const res = await POST(request(longBody));
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe("ai_unavailable");
    expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:gemini", "cloud");
  });

  it("routes a short message's stream through the groq model", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    await POST(request(validBody()));
    expect(getGroqModelMock).toHaveBeenCalledOnce();
    expect(getGeminiModelMock).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: "groq-model-handle" }));
  });

  it("routes a long message's stream through the gemini model", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    const longBody = {
      institutionSlug: "demo",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "a".repeat(221) }] }],
    };
    await POST(request(longBody));
    expect(getGeminiModelMock).toHaveBeenCalledOnce();
    expect(getGroqModelMock).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-model-handle" }));
  });

  it("streams a response and releases the slot after usage logging on success", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockReturnValueOnce({
      totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
      toUIMessageStreamResponse: () => streamResponse,
    });
    const req = request(validBody());
    const res = await POST(req);
    expect(res).toBe(streamResponse);
    // Fix round 1 (security review, MED/LOW-2): bounded output, sequential
    // tool calls, and the request's own abort signal are threaded through.
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 1024, toolCallConcurrency: 1, abortSignal: req.signal }),
    );
    await vi.waitFor(() => expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:groq", "cloud"));
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ ok: true, inputTokens: 10, outputTokens: 5 }));
  });

  it("logs the usage accumulated from completed steps when the stream fails mid-turn", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    const streamResponse = new Response("stream");
    streamTextMock.mockImplementationOnce((opts: { onStepFinish?: (step: unknown) => void }) => {
      // Fix round 1 (security review, LOW-1): two completed steps' usage
      // must survive into the log even though `totalUsage` then rejects.
      opts.onStepFinish?.({ usage: { inputTokens: 7, outputTokens: 3 } });
      opts.onStepFinish?.({ usage: { inputTokens: 4, outputTokens: 2 } });
      return {
        totalUsage: Promise.reject(new Error("stream aborted")),
        toUIMessageStreamResponse: () => streamResponse,
      };
    });
    const res = await POST(request(validBody()));
    expect(res).toBe(streamResponse);
    await vi.waitFor(() =>
      expect(logUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, inputTokens: 11, outputTokens: 5, errorCode: "ai_unavailable" }),
      ),
    );
  });
});
