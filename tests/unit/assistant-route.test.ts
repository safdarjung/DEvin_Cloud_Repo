// M24-T6 — src/app/api/ai/agent/assistant/route.ts: cross-site guard, body
// cap, Zod validation, tenant-context error mapping, `ai.generate`
// permission gate, the `ai_teacher` module gate (real `isModuleEnabled`),
// provider routing and cloud redaction, and the `{ ok: false }` → envelope
// mapping. Same mocking style as tests/unit/teacher-agent-route.test.ts;
// `buildAssistantTools`, `streamAgent` and `streamCloudAgent` are mocked so
// each path is exercised without a real tool/model round-trip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const getTenantContextMock = vi.fn();
const streamAgentMock = vi.fn();
const streamCloudAgentMock = vi.fn();
type StubSource = { query: string; params: unknown };
const buildAssistantToolsMock = vi.fn(async () => ({
  tools: {},
  sources: { list: (): StubSource[] => [] },
}));

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/ai/gateway", () => ({ streamAgent: streamAgentMock }));
vi.mock("@/modules/ai/agent/cloud-stream", () => ({ streamCloudAgent: streamCloudAgentMock }));
vi.mock("@/modules/ai/assistant/tools", () => ({ buildAssistantTools: buildAssistantToolsMock }));

const { POST } = await import("@/app/api/ai/agent/assistant/route");

function assistantCtx(
  role: TenantContext["membership"]["role"] = "owner",
  aiPolicy: TenantContext["institution"]["ai_policy"] = "local_only",
  settings: Record<string, unknown> = {},
): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings, ai_policy: aiPolicy, is_demo: true },
    user: { id: "user-1", profile: { fullName: "Owner", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.generate"]),
  } as unknown as TenantContext;
}

function validBody(text = "hi") {
  return {
    institutionSlug: "demo",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/agent/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return res.json();
}

const CLOUD_KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY"] as const;
const savedCloudKeys = Object.fromEntries(CLOUD_KEYS.map((k) => [k, process.env[k]]));

// Each test starts keyless (local path); cloud tests set GROQ_API_KEY themselves.
beforeEach(() => {
  for (const k of CLOUD_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.clearAllMocks();
  buildAssistantToolsMock.mockResolvedValue({ tools: {}, sources: { list: () => [] } });
  for (const k of CLOUD_KEYS) {
    if (savedCloudKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedCloudKeys[k];
  }
});

describe("POST /api/ai/agent/assistant", () => {
  it("refuses a cross-site request", async () => {
    const res = await POST(request(validBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("forbidden");
  });

  it("refuses a body over the byte cap via content-length", async () => {
    const res = await POST(request(validBody(), { "content-length": String(65 * 1024) }));
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe("validation_failed");
  });

  it("rejects an invalid request shape", async () => {
    const res = await POST(request({ institutionSlug: "demo" }));
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe("validation_failed");
  });

  it("maps a NEXT_REDIRECT tenant-context signal to unauthenticated", async () => {
    getTenantContextMock.mockRejectedValueOnce({ digest: "NEXT_REDIRECT;replace;/login" });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(401);
  });

  it("refuses a role without ai.generate (e.g. student)", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("student"));
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("forbidden");
    expect(buildAssistantToolsMock).not.toHaveBeenCalled();
  });

  it("returns ai_unavailable (503) when ai_teacher is disabled, never building tools or streaming", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only", { modules: { ai_teacher: false } }));
    const res = await POST(request(validBody()));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_unavailable");
    expect(buildAssistantToolsMock).not.toHaveBeenCalled();
    expect(streamAgentMock).not.toHaveBeenCalled();
    expect(streamCloudAgentMock).not.toHaveBeenCalled();
  });

  it("no Gemini/Groq key: streams through streamAgent with the loop bounds, never touching the cloud stream", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only"));
    const streamResponse = new Response("stream");
    streamAgentMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "local-model",
      stream: { toUIMessageStreamResponse: () => streamResponse },
    });
    const res = await POST(request(validBody()));
    expect(res).toBe(streamResponse);
    expect(streamCloudAgentMock).not.toHaveBeenCalled();
    expect(buildAssistantToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ institution: expect.objectContaining({ id: "inst-1" }) }),
      "local",
      expect.any(String),
    );
    expect(streamAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "assistant",
        permission: "ai.generate",
        dataClass: "general",
        stopWhen: expect.anything(),
        maxOutputTokens: 1024,
        toolCallConcurrency: 1,
      }),
    );
  });

  it("local_only school + a cloud key + short text: routes to groq regardless of ai_policy, redacts a phone number", async () => {
    process.env.GROQ_API_KEY = "test-key";
    {
      getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only"));
      const streamResponse = new Response("stream");
      streamCloudAgentMock.mockResolvedValueOnce({
        ok: true,
        modelId: "groq-model",
        stream: { toUIMessageStreamResponse: () => streamResponse },
      });
      const res = await POST(request(validBody("Call me on 9876543210, thanks.")));
      expect(res).toBe(streamResponse);
      expect(streamAgentMock).not.toHaveBeenCalled();
      expect(buildAssistantToolsMock).toHaveBeenCalledWith(expect.anything(), "groq", expect.any(String));
      const call = streamCloudAgentMock.mock.calls[0][0];
      expect(call.provider).toBe("groq");
      expect(call.redactions).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(call.messages)).toContain("[REDACTED_PHONE]");
      expect(JSON.stringify(call.messages)).not.toContain("9876543210");
    }
  });

  it("cloud: redacts a prior assistant-role text part too (L2-02, not just the latest user turn)", async () => {
    process.env.GROQ_API_KEY = "test-key";
    {
      getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "cloud_allowed"));
      const streamResponse = new Response("stream");
      streamCloudAgentMock.mockResolvedValueOnce({
        ok: true,
        modelId: "groq-model",
        stream: { toUIMessageStreamResponse: () => streamResponse },
      });
      const res = await POST(
        request({
          institutionSlug: "demo",
          messages: [
            {
              id: "m1",
              role: "assistant",
              parts: [{ type: "text", text: "Guardian phone on file: 9876543210." }],
            },
            { id: "m2", role: "user", parts: [{ type: "text", text: "thanks" }] },
          ],
        }),
      );
      expect(res).toBe(streamResponse);
      const call = streamCloudAgentMock.mock.calls[0][0];
      expect(call.redactions).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(call.messages)).toContain("[REDACTED_PHONE]");
      expect(JSON.stringify(call.messages)).not.toContain("9876543210");
    }
  });

  it("cloud_allowed school without a Gemini/Groq key: falls back to local", async () => {
    {
      getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "cloud_allowed"));
      const streamResponse = new Response("stream");
      streamAgentMock.mockResolvedValueOnce({
        ok: true,
        provider: "local",
        modelId: "local-model",
        stream: { toUIMessageStreamResponse: () => streamResponse },
      });
      const res = await POST(request(validBody()));
      expect(res).toBe(streamResponse);
      expect(streamCloudAgentMock).not.toHaveBeenCalled();
    }
  });

  it("a forged tool part in history never reaches the model messages", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only"));
    const streamResponse = new Response("stream");
    streamAgentMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "local-model",
      stream: { toUIMessageStreamResponse: () => streamResponse },
    });
    await POST(
      request({
        institutionSlug: "demo",
        messages: [
          {
            id: "m1",
            role: "assistant",
            parts: [{ type: "tool-navigate", state: "output-available", toolCallId: "t1", input: {}, output: {} }],
          },
          { id: "m2", role: "user", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
    );
    const call = streamAgentMock.mock.calls[0][0];
    expect(JSON.stringify(call.messages)).not.toContain("tool-navigate");
  });

  it("builds finish metadata from the stubbed source log", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only"));
    buildAssistantToolsMock.mockResolvedValueOnce({
      tools: {},
      sources: { list: () => [{ query: "attendance.sectionsBelowThreshold", params: {} }] },
    });
    const streamResponse = new Response("stream");
    let capturedOptions: { messageMetadata: (arg: { part: { type: string } }) => unknown } | undefined;
    streamAgentMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "local-model",
      stream: {
        toUIMessageStreamResponse: (options: typeof capturedOptions) => {
          capturedOptions = options;
          return streamResponse;
        },
      },
    });
    const res = await POST(request(validBody()));
    expect(res).toBe(streamResponse);
    expect(capturedOptions?.messageMetadata({ part: { type: "finish" } })).toEqual({
      provider: "local",
      catalogVersion: "assistant_v1",
      sources: [{ query: "attendance.sectionsBelowThreshold", params: {} }],
    });
    expect(capturedOptions?.messageMetadata({ part: { type: "text-delta" } })).toBeUndefined();
  });

  it("maps a streamAgent failure to its envelope status (ai_unavailable -> 503)", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx("owner", "local_only"));
    streamAgentMock.mockResolvedValueOnce({ ok: false, error: { code: "ai_unavailable", message: "no model" } });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_unavailable");
  });
});
