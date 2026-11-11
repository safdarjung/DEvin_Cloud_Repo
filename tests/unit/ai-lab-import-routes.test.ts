// features-18 §C2/§H — POST /api/ai/{lab-safety-note,import-mapping} with the
// REAL gateway (runStructured) and mocked model/provider factories, same
// harness as ai-task-routes.test.ts. Owner-module queries are mocked; the
// Supabase client throws if a route ever touches the DB directly.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { keepsSafetyList } from "@/modules/ai/lab-safety-note";
import { DATA_BLOCK_MARKER_PATTERN } from "@/modules/ai/prompts/data-block";

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
  throw new Error("AI task routes must read through owner queries, never the client directly");
});
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const schoolLabs = vi.fn();
const schoolLabEquipment = vi.fn();
vi.mock("@/modules/school-labs/queries", () => ({ schoolLabs, schoolLabEquipment }));
vi.mock("@/modules/attendance/queries", () => ({ todayInInstitutionTimezone: () => "2026-11-11" }));

const providers = await import("@/lib/ai/providers");
const labNote = await import("@/app/api/ai/lab-safety-note/route");
const importMapping = await import("@/app/api/ai/import-mapping/route");

const LAB = "33333333-3333-4333-8333-333333333333";

function fakeCtx(role: Role, settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings, ai_policy: "local_only", is_demo: false },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost/api/ai/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function modelReturns(output: unknown) {
  generateTextMock.mockResolvedValueOnce({ output, usage: { inputTokens: 10, outputTokens: 20 } });
}

const lastPrompt = (): string => String(generateTextMock.mock.calls.at(-1)![0].prompt);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Every cloud route open: local_only must still never build one.
  process.env.GROQ_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_CLOUD_ENABLED = "true";
});

afterEach(() => {
  expect(providers.getCloudModel).not.toHaveBeenCalled();
  expect(providers.getGroqModel).not.toHaveBeenCalled();
  expect(providers.getGeminiModel).not.toHaveBeenCalled();
  expect(createClientMock).not.toHaveBeenCalled();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
  for (const name of ["lab-safety-note", "import-mapping"]) {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/ai", name, "route.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
  }
});

// Register: two warned items (expired + hazard, out of stock), one fine item whose name sits inside a warned one.
const EQUIPMENT = [
  { id: "e1", labId: LAB, name: "Sulphuric acid", kind: "chemical", quantity: 2, unit: "l", hazardClass: "corrosive", expiryOn: "2026-11-08", condition: "ok" },
  { id: "e2", labId: LAB, name: "Litmus paper", kind: "consumable", quantity: 0, unit: "pcs", hazardClass: null, expiryOn: null, condition: "ok" },
  { id: "e3", labId: LAB, name: "Acid", kind: "chemical", quantity: 9, unit: "l", hazardClass: null, expiryOn: null, condition: "ok" },
  { id: "e4", labId: LAB, name: "Bunsen burner", kind: "equipment", quantity: 6, unit: "pcs", hazardClass: null, expiryOn: null, condition: "ok" },
];
const RULES_NOTE =
  "Before using Chemistry Lab, check: Sulphuric acid: expired 3 days ago; hazard class corrosive. Litmus paper: none left.";

function labSetup(role: Role = "teacher", settings: Record<string, unknown> = {}) {
  getTenantContextMock.mockResolvedValue(fakeCtx(role, settings));
  schoolLabs.mockResolvedValue([{ id: LAB, name: "Chemistry Lab", kind: "science", capacity: 30, isActive: true }]);
  schoolLabEquipment.mockResolvedValue(EQUIPMENT);
}

describe("keepsSafetyList", () => {
  const warnings = [
    { equipmentId: "e1", name: "Sulphuric acid", reasons: ["expired", "hazard"] as const, text: "Sulphuric acid: expired 3 days ago; hazard class corrosive." },
    { equipmentId: "e2", name: "Litmus paper", reasons: ["out_of_stock"] as const, text: "Litmus paper: none left." },
  ].map((w) => ({ ...w, reasons: [...w.reasons] }));
  const register = EQUIPMENT.map((e) => e.name);

  it("keeps a wording that names every item and adds nothing", () => {
    expect(keepsSafetyList("Careful: sulphuric acid expired 3 days ago and is corrosive; litmus paper has run out.", "Lab", warnings, register)).toBe(true);
  });
  it("rejects a wording that drops an item", () => {
    expect(keepsSafetyList("Sulphuric acid expired 3 days ago and is corrosive.", "Lab", warnings, register)).toBe(false);
  });
  it("rejects a wording that names another register item, but not one inside a warned name", () => {
    expect(keepsSafetyList("Sulphuric acid expired 3 days ago; litmus paper is out; keep the Bunsen burner off.", "Lab", warnings, register)).toBe(false);
    expect(keepsSafetyList("Sulphuric acid is corrosive and expired; litmus paper is out.", "Lab", warnings, register)).toBe(true);
  });
  it("rejects an invented number", () => {
    expect(keepsSafetyList("Sulphuric acid expired 5 days ago; litmus paper is out.", "Lab", warnings, register)).toBe(false);
  });
});

describe("POST /api/ai/lab-safety-note", () => {
  it("teacher: a faithful wording comes back as AI, list inside the data block, local model only, output capped", async () => {
    labSetup();
    modelReturns({ warning: "Sulphuric acid expired 3 days ago and is corrosive, so do not use it. Litmus paper has run out." });
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ source: "ai", provider: "local" });
    const prompt = lastPrompt();
    expect(prompt.match(DATA_BLOCK_MARKER_PATTERN)).toHaveLength(2);
    expect(prompt).toContain("Litmus paper: none left.");
    expect(prompt).not.toContain("Bunsen burner");
    expect(generateTextMock.mock.calls[0][0].maxOutputTokens).toBeGreaterThan(0);
    expect(providers.getLocalModel).toHaveBeenCalled();
  });

  it.each([
    ["drops an item", "Sulphuric acid expired 3 days ago and is corrosive."],
    ["adds another item", "Sulphuric acid expired 3 days ago; litmus paper is out; the Bunsen burner is fine."],
    ["invents a number", "Sulphuric acid expired 30 days ago; litmus paper is out."],
  ])("model wording that %s falls back to the deterministic text", async (_case, warning) => {
    labSetup();
    modelReturns({ warning });
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect((await res.json()).data).toEqual({ note: RULES_NOTE, source: "rules", provider: null, model: null });
  });

  it("no warnings: deterministic text, model never called", async () => {
    labSetup();
    schoolLabEquipment.mockResolvedValue([EQUIPMENT[3]]);
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect((await res.json()).data).toMatchObject({ note: "Chemistry Lab: nothing expired, hazard-classed or out of stock.", source: "rules" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("lab of another school (not visible): not_found, model never called", async () => {
    labSetup();
    schoolLabs.mockResolvedValue([]);
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect(res.status).toBe(404);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("accountant (no lab.read): forbidden before any read", async () => {
    labSetup("accountant");
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect(res.status).toBe(403);
    expect(schoolLabEquipment).not.toHaveBeenCalled();
  });

  it("capability off for the role: ai_unavailable", async () => {
    labSetup("teacher", { ai_roles: { teacher: { capabilities: { lab_safety_note: false } } } });
    const res = await labNote.POST(post("lab-safety-note", { institutionSlug: "demo", labId: LAB }));
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(schoolLabEquipment).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/import-mapping", () => {
  it("owner: exact/alias matches skip the model; leftovers only; invalid, taken and duplicate columns dropped; data-like headers never sent", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner"));
    modelReturns({
      matches: [
        { n: 1, column: "guardian_relationship" }, // "Rishta" -> free column: kept
        { n: 2, column: "admission_no" }, // already taken by the alias match: dropped
        { n: 3, column: "guardian_relationship" }, // second claim on one column: dropped
        { n: 4, column: "salary" }, // not an allowed column: dropped
        { n: 9, column: "dob" }, // no such header: ignored
      ],
    });
    const headers = ["Adm No", "Student Name", "Rishta", "Ghar ka pata", "Pita ji", "Remarks", "9876543210"];
    const res = await importMapping.POST(post("import-mapping", { institutionSlug: "demo", entityType: "students", headers }));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.suggestions).toEqual([
      { header: "Adm No", column: "admission_no", source: "rules" },
      { header: "Student Name", column: "first_name", source: "rules" },
      { header: "Rishta", column: "guardian_relationship", source: "ai" },
      { header: "Ghar ka pata", column: null, source: null },
      { header: "Pita ji", column: null, source: null },
      { header: "Remarks", column: null, source: null },
      { header: "9876543210", column: null, source: null },
    ]);
    const prompt = lastPrompt();
    expect(prompt.match(DATA_BLOCK_MARKER_PATTERN)).toHaveLength(2);
    expect(prompt).toContain("1. Rishta");
    expect(prompt).not.toContain("Adm No");
    expect(prompt).not.toContain("9876543210");
    expect(prompt).not.toMatch(/Allowed columns:[^\n]*\badmission_no\b/);
    expect(generateTextMock.mock.calls[0][0].maxOutputTokens).toBeGreaterThan(0);
  });

  it("every header matched deterministically: model never called", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("admin"));
    const res = await importMapping.POST(post("import-mapping", { institutionSlug: "demo", entityType: "staff", headers: ["Emp No", "Full Name", "Designation"] }));
    expect((await res.json()).data.suggestions.every((s: { source: string }) => s.source === "rules")).toBe(true);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("row data, more than 40 headers or a header over 80 chars: validation_failed before any tenant lookup", async () => {
    const base = { institutionSlug: "demo", entityType: "students" };
    for (const body of [
      { ...base, headers: ["Name"], rows: [{ Name: "Asha" }] },
      { ...base, headers: Array.from({ length: 41 }, (_, i) => `H${i}`) },
      { ...base, headers: ["x".repeat(81)] },
      { ...base, entityType: "parents", headers: ["Name"] },
    ]) {
      expect((await importMapping.POST(post("import-mapping", body))).status).toBe(422);
    }
    expect(getTenantContextMock).not.toHaveBeenCalled();
  });

  it("teacher (no data.import): forbidden, model never called", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    const res = await importMapping.POST(post("import-mapping", { institutionSlug: "demo", entityType: "students", headers: ["Rishta"] }));
    expect(res.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
