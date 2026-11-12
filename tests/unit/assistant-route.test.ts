// T4 (ai-roles) — src/app/api/ai/agent/assistant/route.ts now only
// delegates to the shared kernel (`handleAiChat`, kernel/handle-chat.ts).
// This file is the primary coverage for that kernel's generic behavior
// (cross-site guard, body cap, Zod validation, tenant-context mapping, the
// `ai.chat` permission gate, the role-enabled gate, local/cloud choice,
// cloud redaction, capability-driven tool building, and the
// `{provider, catalogVersion, sources}` metadata contract this route's
// client depends on) via the assistant route path; teacher/student-only
// behavior (persona, step cap, concurrencyKey) lives in their own route
// test files, and cross-role tool-filtering/guardian scoping lives in
// tests/db/ai-chat-roles.test.ts. The model itself is always mocked
// (`streamChat`) — never a real provider call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const getTenantContextMock = vi.fn();
const requirePermissionMock = vi.fn();
const streamChatMock = vi.fn();
const buildReadToolsMock = vi.fn<
  (ctx: unknown, catalog: Record<string, string>, nonce: string, onOk?: unknown) => Promise<{ tools: object; registryNameOf: Map<string, string> }>
>(async () => ({
  tools: {},
  registryNameOf: new Map(),
}));
const navigateToolMock = vi.fn(() => null);
const createTaskToolMock = vi.fn(async () => null);
const roleAiConfigMock = vi.fn(() => ({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null }));
const enabledCapabilitiesMock = vi.fn(() => [] as string[]);

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/auth/require", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require")>("@/lib/auth/require");
  return { ...actual, requirePermission: requirePermissionMock };
});
vi.mock("@/lib/ai/gateway", () => ({ streamChat: streamChatMock }));
vi.mock("@/modules/agents/tools", () => ({ buildReadTools: buildReadToolsMock, toolNameFor: (name: string) => name.replace(/\./g, "_") }));
vi.mock("@/modules/ai/assistant/tools", () => ({ navigateTool: navigateToolMock, createTaskTool: createTaskToolMock }));
vi.mock("@/modules/ai/capabilities/resolve", () => ({
  roleAiConfig: roleAiConfigMock,
  enabledCapabilities: enabledCapabilitiesMock,
}));

const { POST } = await import("@/app/api/ai/agent/assistant/route");

function assistantCtx(role: TenantContext["membership"]["role"] = "owner"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Owner", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.chat"]),
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

function okStream(stream: unknown = { toUIMessageStreamResponse: () => new Response("stream-body") }) {
  return { ok: true, provider: "local", modelId: "m", stream };
}

const CLOUD_KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY"] as const;
const savedCloudKeys = Object.fromEntries(CLOUD_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of CLOUD_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.clearAllMocks();
  buildReadToolsMock.mockResolvedValue({ tools: {}, registryNameOf: new Map() });
  navigateToolMock.mockReturnValue(null);
  createTaskToolMock.mockResolvedValue(null);
  roleAiConfigMock.mockReturnValue({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null });
  enabledCapabilitiesMock.mockReturnValue([]);
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

  it("propagates a forbidden ai.chat permission check", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    const { AppError } = await import("@/lib/actions/result");
    requirePermissionMock.mockImplementationOnce(() => {
      throw new AppError("forbidden", "You do not have permission to use AI features.");
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it("returns ai_unavailable (503) when the role's AI chat is turned off, never building tools or streaming", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    roleAiConfigMock.mockReturnValueOnce({ enabled: false, cloud: true, instructions: "", dailyTokenQuota: null });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_unavailable");
    expect(buildReadToolsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it("no Gemini/Groq key: mode local regardless of role.cloud, streamChat gets the loop bounds", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    streamChatMock.mockResolvedValueOnce(okStream());
    const res = await POST(request(validBody()));
    expect(await res.text()).toBe("stream-body");
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "assistant",
        permission: "ai.chat",
        dataClass: "general",
        mode: "local",
        maxOutputTokens: 1024,
      }),
    );
  });

  it("role.cloud=false: stays local even with a Groq key present", async () => {
    process.env.GROQ_API_KEY = "test-key";
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    roleAiConfigMock.mockReturnValueOnce({ enabled: true, cloud: false, instructions: "", dailyTokenQuota: null });
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    expect(streamChatMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "local" }));
  });

  it("role.cloud=true + a Groq key + short text: mode cloud, provider groq, redacts a phone number", async () => {
    process.env.GROQ_API_KEY = "test-key";
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody("Call me on 9876543210, thanks.")));
    const call = streamChatMock.mock.calls[0][0];
    expect(call.mode).toBe("cloud");
    expect(call.provider).toBe("groq");
    expect(call.redactions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(call.messages)).toContain("[REDACTED_PHONE]");
    expect(JSON.stringify(call.messages)).not.toContain("9876543210");
  });

  it("builds a query catalog from enabled capabilities and calls navigate/createTask only when enabled", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    enabledCapabilitiesMock.mockReturnValueOnce(["attendance_overview", "navigate"]);
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    const catalog = buildReadToolsMock.mock.calls[0][1] as Record<string, string>;
    expect(Object.keys(catalog)).toContain("attendance.attendanceTodaySummary");
    expect(navigateToolMock).toHaveBeenCalledOnce();
    expect(createTaskToolMock).not.toHaveBeenCalled();
  });

  it("cloud mode drops a non-aggregate (personal) staff query from the tool catalog", async () => {
    process.env.GROQ_API_KEY = "test-key";
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    enabledCapabilitiesMock.mockReturnValueOnce(["people_overview"]); // personal queries plus one aggregate (enrolment counts)
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    const catalog = buildReadToolsMock.mock.calls[0][1] as Record<string, string>;
    expect(Object.keys(catalog)).toEqual(["people.enrolmentCounts"]);
  });

  it("builds finish metadata from the provider and the source log", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    let capturedOptions: { messageMetadata: (arg: { part: { type: string } }) => unknown } | undefined;
    streamChatMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "m",
      stream: {
        toUIMessageStreamResponse: (options: typeof capturedOptions) => {
          capturedOptions = options;
          return new Response("stream-body");
        },
      },
    });
    await POST(request(validBody()));
    const metadata = capturedOptions?.messageMetadata({ part: { type: "finish" } }) as { provider: string; catalogVersion: string; sources: unknown[] };
    expect(metadata.provider).toBe("local");
    expect(metadata.catalogVersion).toBe("assistant_v1");
    expect(metadata.sources).toEqual([]);
    expect(capturedOptions?.messageMetadata({ part: { type: "text-delta" } })).toBeUndefined();
  });

  it("maps a streamChat failure to its envelope status (ai_unavailable -> 503)", async () => {
    getTenantContextMock.mockResolvedValueOnce(assistantCtx());
    streamChatMock.mockResolvedValueOnce({ ok: false, error: { code: "ai_unavailable", message: "no model" } });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_unavailable");
  });
});
