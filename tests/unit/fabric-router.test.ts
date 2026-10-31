// F-BE-19 — pickVariant (pure selection) and the /api/ai/genui-route
// handler's fail-safe paths: bridge timeout and a bad bridge body must
// both resolve to `{ok:true, data:null}` at 200, same style as
// tests/unit/teacher-agent-route.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";
import { pickVariant, type VisualRouteCandidate } from "@/modules/fabric/router/use-visual-route";

const getTenantContextMock = vi.fn();
const requirePermissionMock = vi.fn();

vi.mock("@/lib/auth/context", () => ({ getTenantContext: getTenantContextMock }));
vi.mock("@/lib/auth/require", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require")>("@/lib/auth/require");
  return { ...actual, requirePermission: requirePermissionMock };
});

const { POST } = await import("@/app/api/ai/genui-route/route");

const CANDIDATES: VisualRouteCandidate[] = [
  { id: "text", question: "Is plain text enough?" },
  { id: "chart", question: "Does this need a chart?" },
];

function fakeCtx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Teacher", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.generate"]),
  } as unknown as TenantContext;
}

function validBody() {
  return {
    institutionSlug: "demo",
    state: "attendance trend for section 8A",
    questions: {
      text: { type: "noul", instructions: "Is plain text enough?" },
      chart: { type: "noul", instructions: "Does this need a chart?" },
    },
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/genui-route", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.LAYA_BRIDGE_URL;
});

describe("pickVariant", () => {
  it("picks the candidate with the highest noul at/above 0.5", () => {
    const answers = { text: { noul: 0.2 }, chart: { noul: 0.8 } };
    expect(pickVariant(answers, CANDIDATES)).toEqual({ variantId: "chart", source: "laya" });
  });

  it("falls back to candidates[0] when no answer clears the threshold", () => {
    const answers = { text: { noul: 0.4 }, chart: { noul: 0.1 } };
    expect(pickVariant(answers, CANDIDATES)).toEqual({ variantId: "text", source: "default" });
  });

  it("falls back to candidates[0] when answers is null", () => {
    expect(pickVariant(null, CANDIDATES)).toEqual({ variantId: "text", source: "default" });
  });

  it("returns null variant for an empty candidate list", () => {
    expect(pickVariant({ text: { noul: 0.9 } }, [])).toEqual({ variantId: null, source: "default" });
  });
});

describe("POST /api/ai/genui-route", () => {
  it("returns data:null when LAYA_BRIDGE_URL is unset", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx());
    delete process.env.LAYA_BRIDGE_URL;

    const res = await POST(request(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: null });
  });

  it("returns data:null when the bridge times out", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx());
    process.env.LAYA_BRIDGE_URL = "http://127.0.0.1:8787/predict";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("Timeout", "TimeoutError"))),
    );

    const res = await POST(request(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: null });
  });

  it("returns data:null when the bridge body is malformed", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx());
    process.env.LAYA_BRIDGE_URL = "http://127.0.0.1:8787/predict";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nonsense: true }),
        }),
      ),
    );

    const res = await POST(request(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: null });
  });

  it("returns the bridge answers on success", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx());
    process.env.LAYA_BRIDGE_URL = "http://127.0.0.1:8787/predict";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ answers: { text: { noul: 0.2 }, chart: { noul: 0.9 } } }),
        }),
      ),
    );

    const res = await POST(request(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { text: { noul: 0.2 }, chart: { noul: 0.9 } } });
  });

  it("rejects more than 6 questions", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx());
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 7; i++) {
      questions[`q${i}`] = { type: "noul", instructions: "x" };
    }

    const res = await POST(request({ ...validBody(), questions }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
  });
});
