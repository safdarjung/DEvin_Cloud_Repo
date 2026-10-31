// GU-08 — src/app/api/ai/agent/student/route.ts: cross-site guard, body
// cap, Zod validation, tenant-context error mapping, permission/entitlement
// gates, and that `streamAgent` (GU-05) is called with the right
// permission/dataClass — not the quota/concurrency/provider logic itself,
// which belongs to ai-gateway.test.ts. Same style as
// tests/unit/teacher-agent-route.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const getTenantContextMock = vi.fn();
const streamAgentMock = vi.fn();
const studentToolsMock = vi.fn(async () => ({}));
const getStudentPreferencesMock = vi.fn(async () => ({
  skills: ["terse"],
  style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
}));

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/ai/gateway", () => ({ streamAgent: streamAgentMock }));
vi.mock("@/modules/ai/agent/student-tools", () => ({ studentTools: studentToolsMock }));
vi.mock("@/modules/ai/student-preferences", () => ({ getStudentPreferences: getStudentPreferencesMock }));

const { POST } = await import("@/app/api/ai/agent/student/route");

function studentCtx(overrides: Partial<TenantContext["membership"]> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Student", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "student", staffId: null, guardianId: null, studentId: "student-1", ...overrides },
    permissions: new Set(["ai.study"]),
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

async function json(res: Response) {
  return res.json();
}

afterEach(() => {
  vi.clearAllMocks();
  getStudentPreferencesMock.mockResolvedValue({
    skills: ["terse"],
    style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
  });
});

describe("POST /api/ai/agent/student", () => {
  it("refuses a cross-site request", async () => {
    const res = await POST(request(validBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error.code).toBe("forbidden");
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

  it("rejects a 'file' part (download-capable)", async () => {
    const body = { institutionSlug: "demo", messages: [{ id: "m1", role: "user", parts: [{ type: "file", url: "https://evil.example/x" }] }] };
    const res = await POST(request(body));
    expect(res.status).toBe(422);
  });

  it("maps a NEXT_REDIRECT tenant-context signal to unauthenticated", async () => {
    getTenantContextMock.mockImplementationOnce(() => {
      const err = new Error("redirect") as Error & { digest: string };
      err.digest = "NEXT_REDIRECT;replace;/login;307;";
      throw err;
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(401);
  });

  it("forbids a guardian (no ai.study permission)", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      membership: { role: "guardian", staffId: null, guardianId: "g1", studentId: null },
      permissions: new Set([]),
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("forbidden");
  });

  it("forbids a teacher (no ai.study permission)", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      membership: { role: "teacher", staffId: "s1", guardianId: null, studentId: null },
      permissions: new Set(["ai.generate"]),
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("forbidden");
  });

  it("returns ai_unavailable when student_ai_study is off", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: { ...studentCtx().institution, settings: { features: { student_ai_study: false } } },
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe("ai_unavailable");
    expect(streamAgentMock).not.toHaveBeenCalled();
  });

  it("passes visualsEnabled=false to studentTools when student_ai_visuals is off", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: {
        ...studentCtx().institution,
        settings: { features: { student_ai_study: true, student_ai_visuals: false } },
      },
    });
    streamAgentMock.mockResolvedValueOnce({ ok: true, provider: "local", modelId: "m", stream: { toUIMessageStreamResponse: () => new Response("ok") } });
    await POST(request(validBody()));
    expect(studentToolsMock).toHaveBeenCalledWith(expect.anything(), { visualsEnabled: false });
  });

  it("passes visualsEnabled=true to studentTools when student_ai_visuals is on (and study is implicitly on via default)", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: {
        ...studentCtx().institution,
        settings: { features: { student_ai_study: true, student_ai_visuals: true } },
      },
    });
    streamAgentMock.mockResolvedValueOnce({ ok: true, provider: "local", modelId: "m", stream: { toUIMessageStreamResponse: () => new Response("ok") } });
    await POST(request(validBody()));
    expect(studentToolsMock).toHaveBeenCalledWith(expect.anything(), { visualsEnabled: true });
  });

  it("calls streamAgent with permission ai.study and dataClass student_personal", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: { ...studentCtx().institution, settings: { features: { student_ai_study: true } } },
    });
    streamAgentMock.mockResolvedValueOnce({ ok: true, provider: "local", modelId: "m", stream: { toUIMessageStreamResponse: () => new Response("ok") } });
    await POST(request(validBody()));
    expect(streamAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "student_study", permission: "ai.study", dataClass: "student_personal" }),
    );
  });

  it("propagates a streamAgent failure as the mapped status/code", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: { ...studentCtx().institution, settings: { features: { student_ai_study: true } } },
    });
    streamAgentMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "ai_policy_blocked", message: "This feature is only available on a local-only AI policy for now." },
    });
    const res = await POST(request(validBody()));
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe("ai_policy_blocked");
  });

  it("returns the stream response on success", async () => {
    getTenantContextMock.mockResolvedValueOnce({
      ...studentCtx(),
      institution: { ...studentCtx().institution, settings: { features: { student_ai_study: true } } },
    });
    streamAgentMock.mockResolvedValueOnce({
      ok: true,
      provider: "local",
      modelId: "m",
      stream: { toUIMessageStreamResponse: () => new Response("stream-body") },
    });
    const res = await POST(request(validBody()));
    expect(await res.text()).toBe("stream-body");
  });
});
