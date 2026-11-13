// 0148 — /api/ai/questions-generate and /api/ai/chapter-summary with a mocked
// gateway and mocked owner queries (each feeds what the caller's RLS would
// return). Retrieval feeds the prompt; no text -> "source content
// insufficient" and no model call unless allowUngrounded; page refs survive
// only inside retrieved chunks; nothing is saved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/actions/result";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

const m = vi.hoisted(() => ({
  runStructured: vi.fn(),
  getTenantContext: vi.fn(),
  createClient: vi.fn(),
  findChunks: vi.fn(),
  listTeachingPairs: vi.fn(),
  listCurriculumUnits: vi.fn(),
  listTopics: vi.fn(),
  createQuestion: vi.fn(),
}));

vi.mock("@/lib/ai/gateway", () => ({ runStructured: m.runStructured }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: m.getTenantContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient, getClaims: vi.fn() }));
vi.mock("@/modules/content/queries", () => ({ findChunks: m.findChunks }));
vi.mock("@/modules/question-bank/queries", () => ({ listTeachingPairs: m.listTeachingPairs }));
vi.mock("@/modules/academics/assignments.queries", () => ({ listCurriculumUnits: m.listCurriculumUnits }));
vi.mock("@/modules/academics/curriculum.queries", () => ({ listTopics: m.listTopics }));
vi.mock("@/modules/question-bank/actions", () => ({ createQuestion: m.createQuestion }));

const questions = await import("@/app/api/ai/questions-generate/route");
const summary = await import("@/app/api/ai/chapter-summary/route");

const GRADE = crypto.randomUUID();
const SUBJECT = crypto.randomUUID();
const BOOK = crypto.randomUUID();
const UNIT = crypto.randomUUID();

function fakeCtx(role: Role, aiPolicy: TenantContext["institution"]["ai_policy"] = "cloud_allowed"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: { modules: allModulesOn() }, ai_policy: aiPolicy, is_demo: false },
    user: { id: "user-1", profile: { fullName: "T", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const chunk = (page: number, body: string) => ({
  chunkId: crypto.randomUUID(),
  subjectTextbookId: BOOK,
  bookTitle: "Science 7",
  chapterNo: 1,
  heading: "Nutrition in Plants",
  pageFrom: page,
  pageTo: page,
  snippet: body,
  rank: 0.5,
  body,
});

const LEAF = "Leaves make food by photosynthesis using sunlight, water and carbon dioxide. ".repeat(4);
const ROOT = "Roots absorb water and minerals from the soil and hold the plant firmly in place. ".repeat(4);

const generated = (qs: unknown[]) => ok({ data: { questions: qs }, provider: "cloud", model: "gemini-test", fallback: false });
const q = (over: Record<string, unknown>) => ({
  type: "short_answer",
  body: "How do leaves make food?",
  options: [],
  answer: "By photosynthesis.",
  answerKey: [],
  explanation: "",
  learningOutcome: "",
  sourceChunk: "C1",
  sourcePage: 14,
  ...over,
});

const base = { institutionSlug: "demo", gradeId: GRADE, subjectId: SUBJECT, curriculumUnitId: UNIT, types: ["short_answer", "mcq"], count: 2, marksEach: 2, difficulty: "easy" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getTenantContext.mockResolvedValue(fakeCtx("teacher"));
  m.listTeachingPairs.mockResolvedValue([{ gradeId: GRADE, gradeCode: "VII", subjectId: SUBJECT, subjectName: "Science" }]);
  m.listCurriculumUnits.mockResolvedValue([{ id: UNIT, title: "Nutrition in Plants", sequence: 1 }]);
  m.listTopics.mockResolvedValue([]);
});

describe("POST /api/ai/questions-generate", () => {
  it("grounds the prompt in retrieved chunks and keeps only page refs inside them", async () => {
    m.findChunks.mockResolvedValueOnce([chunk(14, LEAF), chunk(15, ROOT)]);
    m.runStructured.mockResolvedValueOnce(
      generated([q({}), q({ type: "mcq", body: "Roots absorb?", options: ["Water", "Light"], answer: "Water", sourceChunk: "C2", sourcePage: 99 }), q({ sourceChunk: "C7" })]),
    );

    const res = await questions.POST(post("/api/ai/questions-generate", base));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.grounded).toBe(true);
    expect(data.sources.map((s: { label: string; pageFrom: number }) => [s.label, s.pageFrom])).toEqual([
      ["C1", 14],
      ["C2", 15],
    ]);
    expect(data.drafts).toHaveLength(2); // count caps the third
    expect(data.drafts[0]).toMatchObject({ origin: "ai", aiModel: "gemini-test", sourceSubjectTextbookId: BOOK, sourceChapterNo: 1, sourcePage: 14, curriculumUnitId: UNIT });
    expect(data.drafts[1]).toMatchObject({ type: "mcq", sourceSubjectTextbookId: BOOK, sourcePage: null }); // page 99 not retrieved
    expect(m.findChunks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ q: "nutrition or plants", gradeId: GRADE, subjectId: SUBJECT }));
    const call = m.runStructured.mock.calls[0][0] as { prompt: string; agentCloud: boolean };
    expect(call.agentCloud).toBe(true);
    expect(call.prompt).toContain("[C1] pages 14, chapter 1");
    expect(call.prompt).toContain("Roots absorb water");
    expect(m.createQuestion).not.toHaveBeenCalled();
  });

  it("a local_only school keeps the textbook text off the cloud exception (agentCloud false)", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher", "local_only"));
    m.findChunks.mockResolvedValueOnce([chunk(14, LEAF), chunk(15, ROOT)]);
    m.runStructured.mockResolvedValueOnce(generated([q({})]));
    await questions.POST(post("/api/ai/questions-generate", base));
    expect((m.runStructured.mock.calls[0][0] as { agentCloud: boolean }).agentCloud).toBe(false);
  });

  it("says the source is insufficient and calls no model when nothing is retrieved", async () => {
    m.findChunks.mockResolvedValue([]);
    const res = await questions.POST(post("/api/ai/questions-generate", { ...base, chapterNos: [3] }));
    const { data } = await res.json();
    expect(data).toMatchObject({ grounded: false, drafts: [], sources: [] });
    expect(data.note).toMatch(/^Source content insufficient/);
    expect(m.findChunks).toHaveBeenCalledTimes(2); // words, then the chapter's own text
    expect(m.runStructured).not.toHaveBeenCalled();
  });

  it("with allowUngrounded, drafts carry no source reference", async () => {
    m.findChunks.mockResolvedValue([]);
    m.runStructured.mockResolvedValueOnce(generated([q({ sourceChunk: "C1", sourcePage: 14 })]));
    const res = await questions.POST(post("/api/ai/questions-generate", { ...base, allowUngrounded: true }));
    const { data } = await res.json();
    expect(data.grounded).toBe(false);
    expect(data.drafts[0]).toMatchObject({ sourceSubjectTextbookId: null, sourceChapterNo: null, sourcePage: null });
  });

  it("refuses a grade+subject the teacher does not teach before any retrieval, and roles without question.manage", async () => {
    m.listTeachingPairs.mockResolvedValueOnce([]);
    expect((await questions.POST(post("/api/ai/questions-generate", base))).status).toBe(404);
    expect(m.findChunks).not.toHaveBeenCalled();
    m.getTenantContext.mockResolvedValueOnce(fakeCtx("student"));
    expect((await questions.POST(post("/api/ai/questions-generate", base))).status).toBe(403);
  });
});

describe("POST /api/ai/chapter-summary", () => {
  function bookRow(row: Record<string, unknown> | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
    m.createClient.mockResolvedValue({ from: () => chain });
  }

  it("summarises from the chapter's chunks and drops pages that were not retrieved", async () => {
    bookRow({ id: BOOK, grade_id: GRADE, subject_id: SUBJECT, custom_title: "Science 7", chapter_titles: { "1": "Nutrition in Plants" } });
    m.findChunks.mockResolvedValueOnce([chunk(14, LEAF), chunk(15, ROOT)]);
    m.runStructured.mockResolvedValueOnce(
      ok({ data: { summary: "Plants make food.", keyPoints: [{ point: "Leaves photosynthesise.", page: 14 }, { point: "Invented.", page: 40 }] }, provider: "cloud", model: "gemini-test", fallback: false }),
    );
    const res = await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }));
    const { data } = await res.json();
    expect(data.keyPoints).toEqual([
      { point: "Leaves photosynthesise.", page: 14 },
      { point: "Invented.", page: null },
    ]);
    expect(data.pages).toEqual({ from: 14, to: 15 });
    expect((m.runStructured.mock.calls[0][0] as { agentCloud: boolean }).agentCloud).toBe(true);
    expect(m.findChunks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ subjectTextbookId: BOOK, chapterNos: [1], q: null }));
  });

  it("a local_only school keeps the chapter text off the cloud exception (agentCloud false)", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("teacher", "local_only"));
    bookRow({ id: BOOK, grade_id: GRADE, subject_id: SUBJECT, custom_title: "Science 7", chapter_titles: {} });
    m.findChunks.mockResolvedValueOnce([chunk(14, LEAF), chunk(15, ROOT)]);
    m.runStructured.mockResolvedValueOnce(ok({ data: { summary: "Plants make food.", keyPoints: [] }, provider: "local", model: "llama", fallback: false }));
    await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }));
    expect((m.runStructured.mock.calls[0][0] as { agentCloud: boolean }).agentCloud).toBe(false);
  });

  it("no extracted text: insufficient, no model call", async () => {
    bookRow({ id: BOOK, grade_id: GRADE, subject_id: SUBJECT, custom_title: "Science 7", chapter_titles: {} });
    m.findChunks.mockResolvedValueOnce([]);
    const { data } = await (await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 2 }))).json();
    expect(data.summary).toBeNull();
    expect(data.note).toMatch(/^Source content insufficient/);
    expect(m.runStructured).not.toHaveBeenCalled();
  });

  it("another school's book is not found", async () => {
    bookRow(null);
    expect((await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }))).status).toBe(404);
  });

  it("a student summarises a book they can read, through ai.study", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("student"));
    bookRow({ id: BOOK, grade_id: GRADE, subject_id: SUBJECT, custom_title: "Science 7", chapter_titles: {} });
    m.findChunks.mockResolvedValueOnce([chunk(14, LEAF), chunk(15, ROOT)]);
    m.runStructured.mockResolvedValueOnce(ok({ data: { summary: "Plants make food.", keyPoints: [] }, provider: "cloud", model: "gemini-test", fallback: false }));
    const res = await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.summary).toBe("Plants make food.");
    expect((m.runStructured.mock.calls[0][0] as { permission: string }).permission).toBe("ai.study");
  });

  it("a student whose RLS hides the book's text gets no summary and no model call", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("student"));
    bookRow({ id: BOOK, grade_id: GRADE, subject_id: SUBJECT, custom_title: "Science 7", chapter_titles: {} });
    m.findChunks.mockResolvedValueOnce([]);
    const { data } = await (await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }))).json();
    expect(data.summary).toBeNull();
    expect(m.runStructured).not.toHaveBeenCalled();
  });

  it("a guardian is refused", async () => {
    m.getTenantContext.mockResolvedValue(fakeCtx("guardian"));
    expect((await summary.POST(post("/api/ai/chapter-summary", { institutionSlug: "demo", subjectTextbookId: BOOK, chapterNo: 1 }))).status).toBe(403);
    expect(m.runStructured).not.toHaveBeenCalled();
  });
});
