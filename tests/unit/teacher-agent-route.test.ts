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
  it("rejects a message part type other than text/step-start/tool-*", async () => {
    const res = await POST(
      request({
        institutionSlug: "demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "file", url: "https://evil.example/huge.bin", mediaType: "application/octet-stream" }],
          },
        ],
      }),
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe("validation_failed");
    expect(streamTextMock).not.toHaveBeenCalled();
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

  it("fails closed as ai_unavailable when GEMINI_API_KEY is unset, releasing the slot", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    getGeminiModelMock.mockRejectedValueOnce(new Error("GEMINI_API_KEY is not configured."));
    const res = await POST(request(validBody()));
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe("ai_unavailable");
    expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:gemini", "cloud");
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
    await vi.waitFor(() => expect(releaseConcurrencySlotMock).toHaveBeenCalledWith("inst-1:gemini", "cloud"));
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
