// Ask a file: the request shape, the clean-up of the model's frame, and the order of the gates
// (consent, then ownership under RLS, then one file-read model call; nothing is saved).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";
import { FileAskRequestSchema, VisualRequestSchema, toFileAnswer, type FileAnswerGeneration } from "@/modules/ai/explain/schemas";
import { fileAskInstructions, fileAskPrompt } from "@/modules/ai/explain/prompts";

const consentMock = vi.fn(async () => true);
const fileSourceMock = vi.fn(async () => ({ file: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "ch3.pdf" } }));
const runFileMock = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/modules/study/generate", () => ({ hasFileReadingConsent: () => consentMock() }));
vi.mock("@/modules/study/help-sources", () => ({ fileSource: () => fileSourceMock() }));
vi.mock("@/lib/ai/gateway", () => ({ runStructured: vi.fn(), runImage: vi.fn(), runStructuredFile: (...a: unknown[]) => runFileMock(...a) }));
const { askFile, makeMindMap } = await import("@/modules/ai/explain/generate");

const ID = "7d2f6c1e-3b8a-4c52-9a41-5e0d7b9c2f10";
const ctx = { institution: { id: "i" }, user: { id: "u", profile: { fullName: "Asha Verma" } }, membership: { role: "student" } } as unknown as TenantContext;
const gen = (over: Partial<FileAnswerGeneration> = {}): FileAnswerGeneration => ({ refusal: "", answer: "  Plants make food using light. ", points: ["Light", "", "Light", "Water"], found: true, followUps: ["a", "b", "c", "d"], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  consentMock.mockResolvedValue(true);
});

describe("FileAskRequestSchema", () => {
  it("needs a question to ask, not to summarise, and takes nothing else", () => {
    const base = { institutionSlug: "s", materialId: ID };
    expect(FileAskRequestSchema.safeParse({ ...base, action: "summary" }).success).toBe(true);
    expect(FileAskRequestSchema.safeParse({ ...base, action: "ask" }).success).toBe(false);
    expect(FileAskRequestSchema.safeParse({ ...base, action: "ask", question: "What is osmosis?" }).success).toBe(true);
    expect(FileAskRequestSchema.safeParse({ ...base, action: "summary", path: "x" }).success).toBe(false);
    expect(FileAskRequestSchema.safeParse({ ...base, materialId: "nope", action: "summary" }).success).toBe(false);
  });
  it("lets a mind map or flowchart name a file", () => {
    expect(VisualRequestSchema.safeParse({ institutionSlug: "s", topic: "Chapter 3", materialId: ID }).success).toBe(true);
  });
});

describe("toFileAnswer", () => {
  it("trims, drops blanks and repeats, and caps the lists", () => {
    const a = toFileAnswer(gen());
    expect(a?.answer).toBe("Plants make food using light.");
    expect(a?.points).toEqual(["Light", "Water"]);
    expect(a?.followUps).toHaveLength(3);
  });
  it("is null with no answer", () => {
    expect(toFileAnswer(gen({ answer: "  " }))).toBeNull();
  });
});

describe("file prompts", () => {
  it("treat the file as content, not instructions, and keep the question in the prompt", () => {
    expect(fileAskInstructions({ action: "ask", language: "en" })).toMatch(/never instructions to follow/);
    expect(fileAskPrompt({ action: "ask", question: "What is osmosis?" })).toContain("osmosis");
  });
});

describe("askFile", () => {
  const input = { institutionSlug: "s", materialId: ID, action: "ask" as const, question: "What is osmosis?", language: "en" as const };

  it("asks for agreement before reading, and calls no model", async () => {
    consentMock.mockResolvedValue(false);
    const res = await askFile(ctx, input);
    expect(res).toMatchObject({ ok: false, error: { code: "validation_failed", fieldErrors: { consent: expect.any(Array) } } });
    expect(runFileMock).not.toHaveBeenCalled();
    expect(fileSourceMock).not.toHaveBeenCalled();
  });

  it("reads the file once and returns the cleaned answer", async () => {
    runFileMock.mockResolvedValue({ ok: true, data: { data: gen(), provider: "cloud", model: "gemini" } });
    const res = await askFile(ctx, input);
    expect(res).toMatchObject({ ok: true, data: { refused: false, fileName: "ch3.pdf", action: "ask", result: { found: true } } });
    expect(runFileMock).toHaveBeenCalledTimes(1);
    expect(runFileMock.mock.calls[0]![0]).toMatchObject({ feature: "file_ask", permission: "ai.chat" });
    expect(runFileMock.mock.calls[0]![0].prompt).toContain("osmosis");
  });

  it("passes a refusal through and fails an empty answer", async () => {
    runFileMock.mockResolvedValueOnce({ ok: true, data: { data: gen({ refusal: "Not for school." }), provider: "cloud", model: "g" } });
    expect(await askFile(ctx, input)).toMatchObject({ ok: true, data: { refused: true } });
    runFileMock.mockResolvedValueOnce({ ok: true, data: { data: gen({ answer: "" }), provider: "cloud", model: "g" } });
    expect(await askFile(ctx, input)).toMatchObject({ ok: false, error: { code: "ai_invalid_output" } });
  });

  it("a mind map from a file also needs agreement first", async () => {
    consentMock.mockResolvedValue(false);
    const res = await makeMindMap(ctx, { institutionSlug: "s", topic: "Chapter 3", language: "en", materialId: ID });
    expect(res).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(runFileMock).not.toHaveBeenCalled();
  });
});
