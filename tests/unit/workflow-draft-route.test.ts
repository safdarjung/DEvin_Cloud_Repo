// POST /api/ai/workflow-draft with the REAL gateway (runStructured) and
// mocked model/provider factories, same harness as website-ai-routes.test.ts.
// Draft-only: the section/agent reads are mocked owner-module queries, the
// Supabase client throws if touched, and the workflow write actions are
// spies never called.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
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
}));

vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: vi.fn(async () => {}),
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({ daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4 })),
}));

const getTenantContextMock = vi.fn();
vi.mock("@/lib/auth/context", () => ({ getTenantContext: (...args: unknown[]) => getTenantContextMock(...args) }));

const createClientMock = vi.fn(() => {
  throw new Error("the workflow draft route reads only through owner-module queries");
});
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock, createAnonClient: createClientMock }));

const SECTION_XA = "11111111-2222-4333-8444-555555555555";
vi.mock("@/modules/attendance/queries", () => ({
  getTodaySectionsForTeacher: vi.fn(async () => [
    { id: SECTION_XA, label: "X-A", classTeacherId: null },
    { id: "22222222-2222-4333-8444-555555555555", label: "X-B", classTeacherId: null },
  ]),
}));
vi.mock("@/modules/agents/queries", () => ({
  workflowAgentOptions: vi.fn(async () => [{ slug: "attendance", name: "Attendance agent", summary: "Watches daily attendance." }]),
}));

const writeSpies = { saveWorkflow: vi.fn(), setWorkflowStatus: vi.fn(), runWorkflowNow: vi.fn(), decideWorkflowRun: vi.fn() };
vi.mock("@/modules/workflows/actions", () => writeSpies);

const providers = await import("@/lib/ai/providers");
const { TASK_DATA_BLOCK_MARKER_PATTERN } = await import("@/modules/ai/prompts/task-drafts");
const route = await import("@/app/api/ai/workflow-draft/route");

function fakeCtx(role: Role, settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Sunrise Public School", settings: { modules: allModulesOn(), ...settings }, ai_policy: "local_only", is_demo: false },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const post = (body: unknown): Request =>
  new Request("http://localhost/api/ai/workflow-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const modelReturns = (output: unknown) => generateTextMock.mockResolvedValueOnce({ output, usage: { inputTokens: 10, outputTokens: 20 } });
const lastPrompt = (): string => String(generateTextMock.mock.calls.at(-1)![0].prompt);

const blankStep = { label: "", metric: "", comparison: "", value: 0, section: "", roles: [], message: "", question: "", agent: "", task: "" };
const OWNER_EXAMPLE = {
  name: "Absent students in X-A",
  trigger: { kind: "manual", frequency: "none", weekday: 1, time: "", event: "" },
  steps: [{ ...blankStep, type: "check_number", label: "Absent today in X-A", metric: "attendance.section_absent_today", comparison: "gte", value: 0, section: "X-A" }],
};
const body = { institutionSlug: "demo", description: "number of absent students in class X A" };

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  // Keyless install (no Groq/Gemini key) on a local_only school: these routes run on the local model and
  // Anthropic is never built. The Groq/Gemini path they opt into is covered in ai-structured-cloud.test.ts.
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_CLOUD_ENABLED = "true";
});
afterEach(() => {
  expect(providers.getCloudModel).not.toHaveBeenCalled();
  expect(createClientMock).not.toHaveBeenCalled();
  for (const spy of Object.values(writeSpies)) expect(spy).not.toHaveBeenCalled();
  process.env = { ...ORIGINAL_ENV };
});
afterAll(() => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/ai/workflow-draft/route.ts"), "utf8");
  expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
});

describe("POST /api/ai/workflow-draft", () => {
  it("owner: the owner's example comes back as a by-hand draft measuring X-A; request and sections sit in the data block", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner"));
    modelReturns(OWNER_EXAMPLE);
    const res = await route.POST(post(body));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("Absent students in X-A");
    expect(data.form.trigger.config).toEqual({ kind: "manual" });
    expect(data.form.steps[0].config).toEqual({ metric: "attendance.section_absent_today", op: "gte", value: "0", section: SECTION_XA });
    expect(data.provider).toBe("local");

    const prompt = lastPrompt();
    const markers = [...prompt.matchAll(TASK_DATA_BLOCK_MARKER_PATTERN)];
    expect(markers).toHaveLength(2);
    for (const text of ["class X A", "X-A, X-B"]) {
      const at = prompt.indexOf(text);
      expect(at).toBeGreaterThan(markers[0]!.index!);
      expect(at).toBeLessThan(markers[1]!.index!);
    }
    expect(prompt).not.toContain(SECTION_XA);
  });

  it("model output outside the catalog (unknown metric): ai_invalid_output, no draft", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("principal"));
    modelReturns({ ...OWNER_EXAMPLE, steps: [{ ...OWNER_EXAMPLE.steps[0], metric: "students.absent_total" }] });
    const res = await route.POST(post(body));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("ai_invalid_output");
    expect(json.data).toBeUndefined();
  });

  it("refine: the current draft goes into the data block with section labels, not ids", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner"));
    modelReturns(OWNER_EXAMPLE);
    const currentDraft = {
      name: "Absent students in X-A",
      trigger: { label: "Run by hand", config: { kind: "manual" } },
      steps: [{ type: "condition", label: "Absent today", config: { metric: "attendance.section_absent_today", op: "gte", value: "0", section: SECTION_XA } }],
    };
    const res = await route.POST(post({ ...body, description: "also tell the principal", currentDraft }));
    expect(res.status).toBe(200);
    expect(lastPrompt()).toContain('"section":"X-A"');
    expect(lastPrompt()).not.toContain(SECTION_XA);
  });

  it("admin (no workflow.manage): 403 before the model", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("admin"));
    const res = await route.POST(post(body));
    expect(res.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("capability off for the role: ai_unavailable before the model", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner", { ai_roles: { owner: { capabilities: { workflow_draft: false } } } }));
    const res = await route.POST(post(body));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("description over 1000 characters: validation_failed before any tenant lookup", async () => {
    const res = await route.POST(post({ ...body, description: "x".repeat(1001) }));
    expect(res.status).toBe(422);
    expect(getTenantContextMock).not.toHaveBeenCalled();
  });
});
