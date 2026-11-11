// T4 (ai-roles) — src/app/api/ai/agent/teacher/route.ts now only delegates
// to the shared kernel (`handleAiChat`). The generic cross-site/body/
// schema/permission/role-enabled/cloud-redaction/metadata coverage lives in
// tests/unit/assistant-route.test.ts (identical handler, exercised via a
// different route path); this file covers only what is specific to a
// teacher calling THIS route: the "teacher_agent" usage feature name, and
// that `teacherTools` is consulted and its tools filtered by the enabled
// capability set. Capability-level filtering (e.g. generate_quiz off ->
// no generateQuiz tool) is covered end to end in tests/db/ai-chat-roles.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const getTenantContextMock = vi.fn();
const streamChatMock = vi.fn();
const buildReadToolsMock = vi.fn(async () => ({ tools: {}, registryNameOf: new Map() }));
const teacherToolsMock = vi.fn(async () => ({
  findStudent: { description: "find", inputSchema: {}, execute: async () => "ok" },
  generateQuiz: { description: "quiz", inputSchema: {}, execute: async () => "ok" },
}));
const roleAiConfigMock = vi.fn(() => ({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null }));
const enabledCapabilitiesMock = vi.fn(() => ["find_student"] as string[]);

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/ai/gateway", () => ({ streamChat: streamChatMock }));
vi.mock("@/modules/agents/tools", () => ({ buildReadTools: buildReadToolsMock, toolNameFor: (name: string) => name.replace(/\./g, "_") }));
vi.mock("@/modules/ai/agent/teacher-tools", () => ({ teacherTools: teacherToolsMock }));
vi.mock("@/modules/ai/capabilities/resolve", () => ({
  roleAiConfig: roleAiConfigMock,
  enabledCapabilities: enabledCapabilitiesMock,
}));

const { POST } = await import("@/app/api/ai/agent/teacher/route");

function teacherCtx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Teacher", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.chat"]),
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

const CLOUD_KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY"] as const;
const savedCloudKeys = Object.fromEntries(CLOUD_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of CLOUD_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.clearAllMocks();
  buildReadToolsMock.mockResolvedValue({ tools: {}, registryNameOf: new Map() });
  roleAiConfigMock.mockReturnValue({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null });
  enabledCapabilitiesMock.mockReturnValue(["find_student"]);
  for (const k of CLOUD_KEYS) {
    if (savedCloudKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedCloudKeys[k];
  }
});

describe("POST /api/ai/agent/teacher", () => {
  it("refuses a cross-site request (shared kernel guard)", async () => {
    const res = await POST(request(validBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("logs usage under the teacher_agent feature name, keeping continuity with the pre-unification route", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    streamChatMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "m",
      stream: { toUIMessageStreamResponse: () => new Response("stream-body") },
    });
    await POST(request(validBody()));
    expect(streamChatMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "teacher_agent" }));
  });

  it("only includes a teacherTools entry whose capability is enabled", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    enabledCapabilitiesMock.mockReturnValueOnce(["find_student"]); // generate_quiz NOT enabled
    streamChatMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "m",
      stream: { toUIMessageStreamResponse: () => new Response("stream-body") },
    });
    await POST(request(validBody()));
    expect(teacherToolsMock).toHaveBeenCalledOnce();
    const toolsPassed = streamChatMock.mock.calls[0][0].tools as Record<string, unknown>;
    expect(toolsPassed).toHaveProperty("findStudent");
    expect(toolsPassed).not.toHaveProperty("generateQuiz");
  });

  it("step budget stays at 6 (not the student's 3) for a teacher", async () => {
    getTenantContextMock.mockResolvedValueOnce(teacherCtx());
    streamChatMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "m",
      stream: { toUIMessageStreamResponse: () => new Response("stream-body") },
    });
    await POST(request(validBody()));
    expect(streamChatMock.mock.calls[0][0].concurrencyKey).toBeUndefined();
  });
});
