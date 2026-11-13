import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  pageIsRetrieved,
  QuestionsGenerateRequestSchema,
  resolveSource,
  selectContext,
  toDrafts,
  type GeneratedQuestion,
  type LabelledChunk,
} from "@/modules/content/grounding";

const BOOK = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";

function chunk(n: number, page: number, body = "Plants make food by photosynthesis."): LabelledChunk {
  return {
    label: `C${n}`,
    chunkId: `00000000-0000-4000-8000-00000000000${n}`,
    subjectTextbookId: BOOK,
    bookTitle: "Science 7",
    chapterNo: 2,
    heading: "Plants",
    pageFrom: page,
    pageTo: page,
    snippet: body,
    rank: 1,
    body,
  };
}

const q = (over: Partial<GeneratedQuestion>): GeneratedQuestion => ({
  type: "short_answer",
  body: "What do plants make by photosynthesis?",
  options: [],
  answer: "Food (glucose).",
  answerKey: [],
  explanation: "",
  learningOutcome: "",
  sourceChunk: "C1",
  sourcePage: 14,
  ...over,
});

const base = { gradeId: G, subjectId: S, curriculumUnitId: null, curriculumTopicId: null, difficulty: "easy" as const, marks: 2, aiModel: "gemini-test" };

describe("page-reference validation", () => {
  const chunks = [chunk(1, 14), chunk(2, 15)];

  it("keeps book, chapter and page when the page lies in the cited chunk", () => {
    expect(resolveSource({ sourceChunk: "C1", sourcePage: 14 }, chunks)).toEqual({ sourceSubjectTextbookId: BOOK, sourceChapterNo: 2, sourcePage: 14 });
    expect(resolveSource({ sourceChunk: "[C2]", sourcePage: 15 }, chunks).sourcePage).toBe(15);
  });

  it("drops a page that is outside the cited chunk (never invents a page)", () => {
    expect(resolveSource({ sourceChunk: "C1", sourcePage: 99 }, chunks)).toEqual({ sourceSubjectTextbookId: BOOK, sourceChapterNo: 2, sourcePage: null });
    expect(resolveSource({ sourceChunk: "C1", sourcePage: 0 }, chunks).sourcePage).toBeNull();
  });

  it("drops every source field when the chunk label was not retrieved", () => {
    expect(resolveSource({ sourceChunk: "C9", sourcePage: 14 }, chunks)).toEqual({ sourceSubjectTextbookId: null, sourceChapterNo: null, sourcePage: null });
    expect(resolveSource({ sourceChunk: "", sourcePage: 14 }, chunks).sourceSubjectTextbookId).toBeNull();
  });

  it("pageIsRetrieved checks summary citations against retrieved pages", () => {
    expect(pageIsRetrieved(15, chunks)).toBe(true);
    expect(pageIsRetrieved(16, chunks)).toBe(false);
  });
});

describe("toDrafts", () => {
  const chunks = [chunk(1, 14)];

  it("maps each allowed type through the bank's QuestionCreateSchema as an AI draft", () => {
    const { drafts, dropped } = toDrafts(
      [
        q({}),
        q({ type: "mcq", body: "Plants make?", options: ["Food", "Rocks", "Air"], answer: "Food" }),
        q({ type: "true_false", body: "Plants make food.", answer: "True" }),
        q({ type: "fill_blank", body: "Plants make ___ by ___.", answerKey: ["food", "photosynthesis"], answer: "" }),
        q({ type: "assertion_reason", body: "Read both.", options: ["Plants are producers.", "They make food."], answer: "a" }),
        q({ type: "multi_select", body: "Pick producers.", options: ["Grass", "Lion", "Fern"], answerKey: ["Grass", "Fern"], answer: "" }),
      ],
      base,
      ["short_answer", "mcq", "true_false", "fill_blank", "assertion_reason", "multi_select"],
      chunks,
    );
    expect(dropped).toBe(0);
    expect(drafts).toHaveLength(6);
    for (const d of drafts) {
      expect(d.origin).toBe("ai");
      expect(d.aiModel).toBe("gemini-test");
      expect(d.sourcePage).toBe(14);
      expect(d.sourceSubjectTextbookId).toBe(BOOK);
    }
    expect(drafts[2]).toMatchObject({ type: "true_false", answer: "true" });
    expect(drafts[4]).toMatchObject({ type: "assertion_reason", answer: "A", options: { assertion: "Plants are producers.", reason: "They make food." } });
  });

  it("drops invalid output and types that were not asked for (garbage in)", () => {
    const { drafts, dropped } = toDrafts(
      [
        q({ type: "mcq", options: ["A", "B"], answer: "C" }), // answer not an option
        q({ type: "fill_blank", body: "No blanks here.", answerKey: ["x"] }), // blank count mismatch
        q({ type: "long_answer" }), // not requested
        q({ body: "   " }), // empty body after trim
      ],
      base,
      ["mcq", "fill_blank", "short_answer"],
      chunks,
    );
    expect(drafts).toEqual([]);
    expect(dropped).toBe(4);
  });
});

describe("retrieval helpers", () => {
  it("caps context by characters and labels in rank order", () => {
    const rows = [chunk(1, 1, "a".repeat(5000)), chunk(2, 2, "b".repeat(5000)), chunk(3, 3, "c".repeat(5000))];
    const picked = selectContext(rows, 12_000);
    expect(picked.map((c) => [c.label, c.pageFrom])).toEqual([
      ["C1", 1],
      ["C2", 2],
    ]);
  });

  it("builds an OR query of significant words, or null", () => {
    expect(buildSearchQuery(["Nutrition in Plants", "The leaf"])).toBe("nutrition or plants or leaf");
    expect(buildSearchQuery(["of the", ""])).toBeNull();
  });

  it("request schema caps count and rejects unknown types", () => {
    const ok = { institutionSlug: "s", gradeId: G, subjectId: S, types: ["mcq"], count: 5, marksEach: 1, difficulty: "easy" };
    expect(QuestionsGenerateRequestSchema.safeParse(ok).success).toBe(true);
    expect(QuestionsGenerateRequestSchema.safeParse({ ...ok, count: 11 }).success).toBe(false);
    expect(QuestionsGenerateRequestSchema.safeParse({ ...ok, types: ["match"] }).success).toBe(false);
  });
});
