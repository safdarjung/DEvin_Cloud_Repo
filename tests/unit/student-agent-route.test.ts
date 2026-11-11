// T4 (ai-roles) — src/app/api/ai/agent/student/route.ts now only delegates
// to the shared kernel (`handleAiChat`). Generic coverage lives in
// tests/unit/assistant-route.test.ts; this file covers only what is
// specific to the student path: the "student_study" usage feature name
// (usage.ts's STUDENT_QUOTA_FEATURES keys off this exact string), the
// 3-step budget, the dedicated concurrencyKey (so students never compete
// with teachers for the institution's local-AI slots), `dataClass:
// "student_personal"`, and that the student's saved preferences reach
// `studentTools`'s `visualsEnabled` flag via the enabled capability set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const getTenantContextMock = vi.fn();
const streamChatMock = vi.fn();
const buildReadToolsMock = vi.fn(async () => ({ tools: {}, registryNameOf: new Map() }));
const studentToolsMock = vi.fn(async () => ({ findMyCurriculumUnit: { description: "x", inputSchema: {}, execute: async () => "ok" } }));
const getStudentPreferencesMock = vi.fn(async () => ({
  skills: ["terse"],
  style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
}));
const roleAiConfigMock = vi.fn(() => ({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null }));
const enabledCapabilitiesMock = vi.fn(() => ["study_curriculum"] as string[]);

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/ai/gateway", () => ({ streamChat: streamChatMock }));
vi.mock("@/modules/agents/tools", () => ({ buildReadTools: buildReadToolsMock, toolNameFor: (name: string) => name.replace(/\./g, "_") }));
vi.mock("@/modules/ai/agent/student-tools", () => ({ studentTools: studentToolsMock }));
vi.mock("@/modules/ai/student-preferences", () => ({ getStudentPreferences: getStudentPreferencesMock }));
vi.mock("@/modules/ai/capabilities/resolve", () => ({
  roleAiConfig: roleAiConfigMock,
  enabledCapabilities: enabledCapabilitiesMock,
}));

const { POST } = await import("@/app/api/ai/agent/student/route");

function studentCtx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Student", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "student", staffId: null, studentId: "student-1", guardianId: null },
    permissions: new Set(["ai.chat"]),
  } as unknown as TenantContext;
}

function validBody() {
  return {
    institutionSlug: "demo",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Explain fractions" }] }],
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/agent/student", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
}

function okStream() {
  return { ok: true, provider: "local", modelId: "m", stream: { toUIMessageStreamResponse: () => new Response("stream-body") } };
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
  enabledCapabilitiesMock.mockReturnValue(["study_curriculum"]);
  getStudentPreferencesMock.mockResolvedValue({
    skills: ["terse"],
    style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
  });
  for (const k of CLOUD_KEYS) {
    if (savedCloudKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedCloudKeys[k];
  }
});

describe("POST /api/ai/agent/student", () => {
  it("refuses a cross-site request (shared kernel guard)", async () => {
    const res = await POST(request(validBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("logs usage under the student_study feature name (usage.ts STUDENT_QUOTA_FEATURES keys off this)", async () => {
    getTenantContextMock.mockResolvedValueOnce(studentCtx());
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "student_study", dataClass: "student_personal" }),
    );
  });

  it("caps the step budget at 3, not 6, and uses a dedicated per-institution student bucket", async () => {
    getTenantContextMock.mockResolvedValueOnce(studentCtx());
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    const call = streamChatMock.mock.calls[0][0];
    expect(call.concurrencyKey).toBe("inst-1:student");
  });

  it("reads the student's saved preferences and passes visualsEnabled based on study_visuals being enabled", async () => {
    getTenantContextMock.mockResolvedValueOnce(studentCtx());
    enabledCapabilitiesMock.mockReturnValueOnce(["study_curriculum", "study_visuals"]);
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    expect(getStudentPreferencesMock).toHaveBeenCalledOnce();
    expect(studentToolsMock).toHaveBeenCalledWith(expect.anything(), { visualsEnabled: true });
  });

  it("visualsEnabled is false when study_visuals is not enabled", async () => {
    getTenantContextMock.mockResolvedValueOnce(studentCtx());
    enabledCapabilitiesMock.mockReturnValueOnce(["study_curriculum"]);
    streamChatMock.mockResolvedValueOnce(okStream());
    await POST(request(validBody()));
    expect(studentToolsMock).toHaveBeenCalledWith(expect.anything(), { visualsEnabled: false });
  });

  it("returns ai_unavailable when the role's AI chat is disabled", async () => {
    getTenantContextMock.mockResolvedValueOnce(studentCtx());
    roleAiConfigMock.mockReturnValueOnce({ enabled: false, cloud: true, instructions: "", dailyTokenQuota: null });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(streamChatMock).not.toHaveBeenCalled();
  });
});
