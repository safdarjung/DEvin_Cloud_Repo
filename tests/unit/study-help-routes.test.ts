// 0140 study help routes with the REAL gateway (runStructured /
// runStructuredFile) and mocked model/provider factories, same harness as
// study-ai-routes.test.ts. Covers the multimodal gate (wrong provider,
// over-size, cloud switch off, consent, not the caller's file), the revision
// pack source, the mock exam route and the translate route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allModulesOn } from "@/lib/modules/catalog";
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

const logUsageMock = vi.fn(async () => {});
vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: (...args: unknown[]) => logUsageMock(...(args as [])),
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({ daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4 })),
}));

const getTenantContextMock = vi.fn();
vi.mock("@/lib/auth/context", () => ({ getTenantContext: (...args: unknown[]) => getTenantContextMock(...args) }));

const FILE = "22222222-2222-4222-8222-222222222222";
const UNIT = "11111111-1111-4111-8111-111111111111";
const UNIT2 = "33333333-3333-4333-8333-333333333333";
const MAT = "44444444-4444-4444-8444-444444444444";
const SUBJ = "55555555-5555-4555-8555-555555555555";

// Read-only fake: a table fixture is one row (maybeSingle) or a list (awaited); nothing writes.
let TABLES: Record<string, unknown>;
const baseTables = (): Record<string, unknown> => ({
  enrolments: { class_section_id: "sec-1" },
  class_sections: { grade_id: "g7", name: "A", grades: { display_name: "Class VII" } },
  subject_assignments: [{ id: "sa-1", subject_id: SUBJ }],
  curriculum_units: [
    { id: UNIT, title: "Light and reflection", description: "Laws of reflection; plane mirrors.", subject_id: SUBJ },
    { id: UNIT2, title: "Sound", description: "Vibration and echoes.", subject_id: SUBJ },
  ],
  grades: { display_name: "Class VII" },
  subjects: [{ id: SUBJ, name: "Science" }],
  curriculum_materials: { id: FILE, title: "My light notes", grade_id: "g7", subject_id: SUBJ, curriculum_unit_id: null, owner_kind: "student", student_id: "stu-1", visibility: "private", created_by: "user-1" },
  documents: { path: "inst-1/curriculum_material/x/y.pdf", mime: "application/pdf", size_bytes: 1200, file_name: "light.pdf" },
  study_ai_consents: { kind: "file_reading" },
  practice_attempts: [],
  study_quiz_attempts: [],
  mastery_snapshots: [],
});
function fakeClient() {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "or", "like", "order", "limit", "gte", "is"]) b[m] = () => b;
      const fixture = TABLES[table];
      const single = Array.isArray(fixture) ? (fixture[0] ?? null) : (fixture ?? null);
      b.maybeSingle = async () => ({ data: single, error: null });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: Array.isArray(fixture) ? fixture : fixture ? [fixture] : [], error: null });
      return b;
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/object" }, error: null }) }) },
    rpc: async () => ({ data: [], error: null }),
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient(), createAnonClient: async () => fakeClient() }));

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >>\n2 0 obj << /Type /Page >>\nLight reflects off a mirror at equal angles.");
const fetchMock = vi.fn(async () => new Response(PDF, { status: 200, headers: { "content-length": String(PDF.byteLength) } }));

const studentRoute = await import("@/app/api/ai/study-generate/route");
const teacherRoute = await import("@/app/api/ai/study-teacher-generate/route");
const mockRoute = await import("@/app/api/ai/study-mock/route");
const translateRoute = await import("@/app/api/ai/study-translate/route");

let aiPolicy: TenantContext["institution"]["ai_policy"] = "local_only";
function fakeCtx(role: Role, aiRoles: Record<string, unknown> = {}): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Sunrise Public School", settings: { modules: allModulesOn(), ai_roles: aiRoles }, ai_policy: aiPolicy, is_demo: false },
    user: { id: "user-1", profile: { fullName: "Asha Verma", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: role === "teacher" ? "staff-1" : null, guardianId: null, studentId: role === "student" ? "stu-1" : null },
    permissions: new Set(permissionsFor(role)),
  };
}

const post = (route: string, body: unknown) =>
  new Request(`http://localhost/api/ai/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const modelReturns = (output: unknown) => generateTextMock.mockResolvedValueOnce({ output, usage: { inputTokens: 10, outputTokens: 20 } });
const lastCall = () => generateTextMock.mock.calls.at(-1)![0] as { prompt?: string; instructions: string; messages?: { content: { type: string; mediaType?: string; text?: string }[] }[] };
const SUMMARY = { summary: "Light reflects at equal angles.", keyPoints: ["Incidence equals reflection", "Plane mirrors", "Normal line"] };
const fileBody = { institutionSlug: "demo", format: "quick_summary", source: { kind: "file", materialId: FILE } };

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  TABLES = baseTables();
  aiPolicy = "local_only";
  process.env.GROQ_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("study from an uploaded file (multimodal gate)", () => {
  beforeEach(() => {
    aiPolicy = "cloud_allowed";
  });

  it("refuses under a local_only policy: the file never reaches a cloud provider", async () => {
    aiPolicy = "local_only";
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect((await res.json()).error.code).toBe("ai_policy_blocked");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("reads the student's own file through Gemini with one file part and logs usage", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    modelReturns(SUMMARY);
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ sourceKind: "file", sourceMaterialId: FILE, provider: "cloud", model: "gemini-flash-lite-latest" });
    const call = lastCall();
    const parts = call.messages![0]!.content;
    expect(parts.filter((p) => p.type === "file")).toHaveLength(1);
    expect(parts.find((p) => p.type === "file")!.mediaType).toBe("application/pdf");
    // The provider never gets the real file name ("light.pdf" in the fixture), only a neutral one.
    expect((parts.find((p) => p.type === "file") as { filename?: string }).filename).toBe("document.pdf");
    expect(JSON.stringify(call)).not.toContain("light.pdf");
    expect(call.prompt).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://storage.test/object", expect.anything());
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "study_material", provider: "cloud", model: "gemini-flash-lite-latest", ok: true }));
  });

  it("refuses when only a text-only provider is configured (no silent fallback)", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    delete process.env.GEMINI_API_KEY;
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "ai_unavailable", message: expect.stringContaining("cannot be read right now") });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses a file over the 10 MB cap before fetching it", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.documents = { ...(TABLES.documents as object), size_bytes: 10 * 1024 * 1024 + 1 };
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses when the role's cloud switch is off", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student", { student: { cloud: false } }));
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect((await res.json()).error.code).toBe("ai_policy_blocked");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("needs the one-time consent tick first", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.study_ai_consents = null;
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(422);
    expect((await res.json()).error.fieldErrors).toHaveProperty("consent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses another student's private file even if a row is visible", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.curriculum_materials = { ...(TABLES.curriculum_materials as object), student_id: "stu-2", created_by: "user-2" };
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a teacher cannot have the AI read a student's private (suggested) file", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    TABLES.curriculum_materials = { ...(TABLES.curriculum_materials as object), created_by: "user-2", student_id: "stu-2" };
    const res = await teacherRoute.POST(post("study-teacher-generate", fileBody));
    expect(res.status).toBe(404);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not the declared type", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    fetchMock.mockResolvedValueOnce(new Response(new TextEncoder().encode("not a pdf at all"), { status: 200 }));
    const res = await studentRoute.POST(post("study-generate", fileBody));
    expect(res.status).toBe(422);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("revision pack source (weak units)", () => {
  it("sends only the weakest unit of the student's own subjects, never scores", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    const now = new Date().toISOString();
    TABLES.study_quiz_attempts = [
      { curriculum_unit_id: UNIT2, auto_score: 1, auto_max: 5, ai_points: 0, ai_max: 0, created_at: now },
      { curriculum_unit_id: UNIT, auto_score: 5, auto_max: 5, ai_points: 0, ai_max: 0, created_at: now },
      { curriculum_unit_id: "99999999-9999-4999-8999-999999999999", auto_score: 0, auto_max: 9, ai_points: 0, ai_max: 0, created_at: now },
    ];
    modelReturns({ sections: [{ heading: "Sound", points: ["Vibrations make sound"] }, { heading: "Echo", points: ["Reflected sound"] }] });
    const res = await studentRoute.POST(post("study-generate", { institutionSlug: "demo", format: "revision_notes", source: { kind: "weak_units" } }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ sourceKind: "revision_pack", focusUnitIds: [UNIT2] });
    const { prompt } = lastCall();
    expect(prompt).toContain("Sound");
    expect(prompt).not.toContain("Light and reflection");
    expect(prompt).not.toMatch(/\d+%/);
  });

  it("says so plainly when there is not enough evidence yet", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    const res = await studentRoute.POST(post("study-generate", { institutionSlug: "demo", format: "revision_notes", source: { kind: "weak_units" } }));
    expect(res.status).toBe(422);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

const gq = (type: "mcq" | "true_false" | "short", unitNumber: number) => ({
  type,
  stem: `${type} question`,
  options: type === "mcq" ? ["a", "b", "c", "d"] : [],
  answerIndex: type === "mcq" ? 0 : -1,
  answerTrue: true,
  modelAnswer: type === "short" ? "Model." : "",
  rubric: type === "short" ? ["point"] : [],
  explanation: "Why.",
  unitNumber,
});

describe("POST /api/ai/study-mock", () => {
  it("builds a timed paper by section from the student's own chosen units", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    modelReturns({ questions: [...Array.from({ length: 6 }, () => gq("mcq", 1)), ...Array.from({ length: 3 }, () => gq("true_false", 2)), gq("short", 1), gq("short", 2)] });
    const res = await mockRoute.POST(post("study-mock", { institutionSlug: "demo", scope: { kind: "units", subjectId: SUBJ, unitIds: [UNIT, UNIT2], durationMinutes: 30 }, count: 10, difficulty: "medium" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.content.durationMinutes).toBe(30);
    expect(data.content.questions.map((q: { type: string }) => q.type)).toEqual(["mcq", "mcq", "mcq", "mcq", "mcq", "true_false", "true_false", "true_false", "short", "short"]);
    expect(data.content.questionUnits).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 0, 1]);
    expect(data.focusUnitIds).toEqual([UNIT, UNIT2]);
    const { prompt, instructions } = lastCall();
    expect(prompt).toContain("exactly 5 mcq, 3 true_false and 2 short");
    expect(prompt).toContain("Unit 2: Sound");
    expect(instructions).toContain("practice only");
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "study_mock", ok: true }));
  });

  it("refuses units outside the student's subjects before any model call", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    const res = await mockRoute.POST(
      post("study-mock", { institutionSlug: "demo", scope: { kind: "units", subjectId: UNIT, unitIds: ["99999999-9999-4999-8999-999999999999"], durationMinutes: 30 }, count: 10, difficulty: "easy" }),
    );
    expect(res.status).toBe(404);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("a paper the student cannot see is not_found", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    const res = await mockRoute.POST(post("study-mock", { institutionSlug: "demo", scope: { kind: "paper", paperId: UNIT }, count: 10, difficulty: "easy" }));
    expect(res.status).toBe(404);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("teachers cannot use the student mock route", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    const res = await mockRoute.POST(post("study-mock", { institutionSlug: "demo", scope: { kind: "paper", paperId: UNIT }, count: 10, difficulty: "easy" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/ai/study-translate", () => {
  const material = {
    id: MAT,
    user_id: "user-1",
    owner_role: "student",
    format: "flashcards",
    title: "Flashcard deck: Light",
    subject_id: null,
    curriculum_unit_id: null,
    created_at: new Date().toISOString(),
    content: { cards: [{ id: "c1", front: "Mirror", back: "Reflects light" }] },
    language: "en",
    variant_of: null,
    source_kind: "unit",
    resource_id: null,
    source_material_id: null,
    bundle_id: null,
    focus_unit_ids: [],
    subjects: null,
  };

  it("keeps the structure and ids, translates title and text item by item", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.study_materials = material;
    modelReturns({ items: ["फ़्लैशकार्ड: प्रकाश", "दर्पण", "प्रकाश को परावर्तित करता है"] });
    const res = await translateRoute.POST(post("study-translate", { institutionSlug: "demo", materialId: MAT, language: "hi" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ baseId: MAT, format: "flashcards", language: "hi", title: "फ़्लैशकार्ड: प्रकाश" });
    expect(data.content).toEqual({ cards: [{ id: "c1", front: "दर्पण", back: "प्रकाश को परावर्तित करता है" }] });
    expect(lastCall().prompt).toContain("[2] Mirror");
    expect(logUsageMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "study_translate", ok: true }));
  });

  it("a wrong item count gets the one repair retry, then a clean ai_invalid_output", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.study_materials = material;
    modelReturns({ items: ["one"] });
    modelReturns({ items: ["still one"] });
    const res = await translateRoute.POST(post("study-translate", { institutionSlug: "demo", materialId: MAT, language: "hi" }));
    expect((await res.json()).error.code).toBe("ai_invalid_output");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a material already in that language", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    TABLES.study_materials = { ...material, language: "hi" };
    const res = await translateRoute.POST(post("study-translate", { institutionSlug: "demo", materialId: MAT, language: "hi" }));
    expect(res.status).toBe(422);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("study-generate with a saved study scope (item 8)", () => {
  const BOOK = "66666666-6666-4666-8666-666666666666";
  const SCOPE_ID = "77777777-7777-4777-8777-777777777777";
  beforeEach(() => {
    TABLES.documents = [];
    TABLES.study_sessions = [];
    TABLES.study_materials = [];
    TABLES.subject_textbooks = [{ id: BOOK, subject_id: SUBJ, custom_title: "Science for VII", custom_chapters: 8, chapter_titles: { "1": "Light" }, position: 0, ncert_textbooks: null }];
    TABLES.curriculum_unit_chapters = [{ curriculum_unit_id: UNIT, subject_textbook_id: BOOK, chapter_no: 1 }];
    TABLES.study_items = {
      id: SCOPE_ID,
      title: "Science: Light",
      updated_at: new Date().toISOString(),
      content: { messages: [] },
      scope: { subjectIds: [SUBJ], chapters: [{ textbookId: BOOK, chapterNo: 1 }], unitIds: [UNIT2, "99999999-9999-4999-8999-999999999999"], goal: "Revise before Friday" },
    };
  });

  it("rebuilds the context from the database: chapter title, unit outlines, the honesty line; a foreign unit is dropped", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("student"));
    modelReturns(SUMMARY);
    const res = await studentRoute.POST(post("study-generate", { institutionSlug: "demo", format: "quick_summary", source: { kind: "scope", itemId: SCOPE_ID } }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ sourceKind: "scope", focusUnitIds: [UNIT, UNIT2], subjectId: SUBJ });
    const { prompt } = lastCall();
    expect(prompt).toContain("Chapters: 1 (Light)");
    expect(prompt).toContain("Laws of reflection; plane mirrors.");
    expect(prompt).toContain("Vibration and echoes.");
    expect(prompt).toContain("You have not read it.");
    expect(prompt).toContain("Revise before Friday");
    expect(prompt).not.toContain("99999999");
  });

  it("teachers cannot use a student's scope", async () => {
    getTenantContextMock.mockResolvedValue(fakeCtx("teacher"));
    const res = await teacherRoute.POST(post("study-teacher-generate", { institutionSlug: "demo", format: "quick_summary", source: { kind: "scope", itemId: SCOPE_ID } }));
    expect(res.status).toBe(422);
  });
});
