// POST /api/ai/{website-draft,website-theme} with the REAL gateway
// (runStructured) and mocked model/provider factories, same harness as
// ai-task-routes.test.ts. Draft-only: the Supabase client throws if a route
// touches the DB, and the website write actions are spies never called.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

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
  throw new Error("website AI routes must never touch the database");
});
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock, createAnonClient: createClientMock }));

const writeSpies = { savePageVersion: vi.fn(), publishPage: vi.fn(), saveWebsiteTheme: vi.fn() };
vi.mock("@/modules/website/actions", () => writeSpies);

const providers = await import("@/lib/ai/providers");
const { TASK_DATA_BLOCK_MARKER_PATTERN } = await import("@/modules/ai/prompts/task-drafts");
const draftRoute = await import("@/app/api/ai/website-draft/route");
const themeRoute = await import("@/app/api/ai/website-theme/route");

function fakeCtx(role: Role, settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Sunrise Public School", settings, ai_policy: "local_only", is_demo: false },
    user: { id: "user-1", profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost/api/ai/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  for (const spy of Object.values(writeSpies)) expect(spy).not.toHaveBeenCalled();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  // Static half of "writes nothing": neither route imports an action file.
  for (const name of ["website-draft", "website-theme"]) {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/ai", name, "route.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
  }
});

const GEN_PAGE = {
  blocks: [
    { type: "hero", heading: "Admissions open", subheading: "Join us this year.", ctaLabel: "Enquire", ctaHref: "https://evil.example/phish" },
    { type: "rich_text", heading: "How to apply", paragraphs: ["Visit the office."], bullets: ["Birth certificate", "Photos"] },
    { type: "stats", heading: "", items: [{ label: "Students", value: "[number]" }] },
    { type: "contact", heading: "Reach us" },
    { type: "enquiry_form", heading: "", ctaLabel: "Send" },
  ],
};

describe("POST /api/ai/website-draft", () => {
  const body = { institutionSlug: "demo", kind: "admissions", brief: "Admissions page for nursery to class V" };

  it("admissions (website.edit): returns validated blocks; external CTA dropped; prompt has school name and brief in the data block", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("admissions"));
    modelReturns(GEN_PAGE);
    const res = await draftRoute.POST(post("website-draft", body));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.provider).toBe("local");
    expect(data.blocks[0]).toEqual({ type: "hero", heading: "Admissions open", subheading: "Join us this year." });
    expect(data.blocks[1]).toEqual({
      type: "rich_text",
      nodes: [
        { type: "heading", level: 2, text: "How to apply" },
        { type: "paragraph", spans: [{ text: "Visit the office." }] },
        { type: "list", ordered: false, items: ["Birth certificate", "Photos"] },
      ],
    });
    expect(data.blocks[3]).toEqual({ type: "contact", heading: "Reach us" });
    expect(data.blocks[4]).toEqual({ type: "enquiry_form", ctaLabel: "Send" });

    const prompt = lastPrompt();
    expect(prompt).toContain("Sunrise Public School");
    const markers = [...prompt.matchAll(TASK_DATA_BLOCK_MARKER_PATTERN)];
    expect(markers).toHaveLength(2);
    const briefAt = prompt.indexOf("nursery to class V");
    expect(briefAt).toBeGreaterThan(markers[0]!.index!);
    expect(briefAt).toBeLessThan(markers[1]!.index!);
  });

  it("refine: current blocks go into the data block; the contact details and hero image the AI may not write are kept", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner"));
    modelReturns({ blocks: [
      { type: "hero", heading: "Welcome", subheading: "", ctaLabel: "Apply", ctaHref: "/admissions" },
      { type: "contact", heading: "Find us" },
    ] });
    const currentBlocks = [
      { type: "hero", heading: "Old", imageUrl: "https://cdn.example/school.jpg" },
      { type: "contact", address: "12 MG Road, Pune", phone: "020 1234 5678", email: "office@sunrise.example" },
    ];
    const res = await draftRoute.POST(post("website-draft", { ...body, kind: "home", brief: "Shorter and warmer", tone: "warm", currentBlocks }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.blocks).toEqual([
      { type: "hero", heading: "Welcome", imageUrl: "https://cdn.example/school.jpg", cta: { label: "Apply", href: "/admissions" } },
      { type: "contact", heading: "Find us", address: "12 MG Road, Pune", phone: "020 1234 5678", email: "office@sunrise.example" },
    ]);
    expect(lastPrompt()).toContain("12 MG Road");
  });

  it("schema-invalid model output (empty hero heading): one clean ai_invalid_output, no partial page", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("principal"));
    modelReturns({ blocks: [{ type: "hero", heading: "", subheading: "", ctaLabel: "", ctaHref: "" }] });
    const res = await draftRoute.POST(post("website-draft", body));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("ai_invalid_output");
    expect(json.data).toBeUndefined();
  });

  it("unauthenticated: 401", async () => {
    getTenantContextMock.mockRejectedValueOnce({ digest: "NEXT_REDIRECT;replace;/login" });
    const res = await draftRoute.POST(post("website-draft", body));
    expect(res.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("teacher (no website.edit): 403 before the model", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    const res = await draftRoute.POST(post("website-draft", body));
    expect(res.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("capability off for the role: ai_unavailable", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner", { ai_roles: { owner: { capabilities: { website_page_draft: false } } } }));
    const res = await draftRoute.POST(post("website-draft", body));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("brief over 1000 chars or unknown page kind: validation_failed before any tenant lookup", async () => {
    const long = await draftRoute.POST(post("website-draft", { ...body, brief: "x".repeat(1001) }));
    const kind = await draftRoute.POST(post("website-draft", { ...body, kind: "blog" }));
    expect(long.status).toBe(422);
    expect(kind.status).toBe(422);
    expect(getTenantContextMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/website-theme", () => {
  const body = { institutionSlug: "demo", brief: "warm, traditional, navy and gold" };
  const theme = {
    primary: "#1E3A8A",
    accent: "#D4A017",
    background: "#FFFDF7",
    foreground: "#1F2937",
    headingFont: "classic_serif",
    bodyFont: "system",
    radius: "small",
    heroStyle: "banner",
  };

  it("principal (website.publish): returns a validated theme; the brief sits in the data block", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("principal"));
    modelReturns(theme);
    const res = await themeRoute.POST(post("website-theme", body));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.theme).toEqual(theme);
    expect(data.provider).toBe("local");
    const prompt = lastPrompt();
    const markers = [...prompt.matchAll(TASK_DATA_BLOCK_MARKER_PATTERN)];
    expect(prompt.indexOf("navy and gold")).toBeGreaterThan(markers[0]!.index!);
  });

  it("model output with CSS injection in a colour: ai_invalid_output, nothing returned", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("owner"));
    modelReturns({ ...theme, primary: "#000000;background:url(https://evil.example)" });
    const res = await themeRoute.POST(post("website-theme", body));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("ai_invalid_output");
    expect(json.data).toBeUndefined();
  });

  it("unauthenticated: 401", async () => {
    getTenantContextMock.mockRejectedValueOnce({ digest: "NEXT_REDIRECT;replace;/login" });
    expect((await themeRoute.POST(post("website-theme", body))).status).toBe(401);
  });

  it("admissions (website.edit but not website.publish): 403 before the model", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("admissions"));
    const res = await themeRoute.POST(post("website-theme", body));
    expect(res.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("capability off for the role: ai_unavailable", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("admin", { ai_roles: { admin: { capabilities: { website_theme_draft: false } } } }));
    const res = await themeRoute.POST(post("website-theme", body));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
