// D31 — generative-UI block catalog schemas (C-69: unknown kind or an
// oversize field is rejected).
import { describe, expect, it } from "vitest";
import {
  BlockSchema,
  CalloutBlockSchema,
  ChartBlockSchema,
  FlashcardsBlockSchema,
  MindmapBlockSchema,
  NotesBlockSchema,
  PracticeBlockSchema,
  TableBlockSchema,
} from "@/modules/ai/blocks/schemas";

const validNotes = {
  kind: "notes",
  sections: [{ heading: "Photosynthesis", bullets: ["Plants make food from light."] }],
};

describe("BlockSchema (C-69)", () => {
  it("accepts one valid block of each kind", () => {
    expect(NotesBlockSchema.safeParse(validNotes).success).toBe(true);
    expect(
      TableBlockSchema.safeParse({ kind: "table", columns: ["A", "B"], rows: [["1", "2"]] }).success,
    ).toBe(true);
    expect(
      FlashcardsBlockSchema.safeParse({ kind: "flashcards", cards: [{ front: "2+2", back: "4" }] }).success,
    ).toBe(true);
    expect(
      PracticeBlockSchema.safeParse({
        kind: "practice",
        questions: [{ stem: "2+2=?", options: ["1", "2", "3", "4"], answer: "4" }],
      }).success,
    ).toBe(true);
    expect(CalloutBlockSchema.safeParse({ kind: "callout", tone: "tip", text: "Remember this." }).success).toBe(
      true,
    );
  });

  it("rejects an unknown kind", () => {
    expect(BlockSchema.safeParse({ kind: "video", url: "https://example.com" }).success).toBe(false);
  });

  it("rejects a notes section with a heading over 120 chars", () => {
    const broken = structuredClone(validNotes);
    broken.sections[0].heading = "x".repeat(121);
    expect(NotesBlockSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects notes with more than 10 sections", () => {
    const broken = { kind: "notes", sections: Array.from({ length: 11 }, () => validNotes.sections[0]) };
    expect(NotesBlockSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a table row whose cell count doesn't match the column count", () => {
    const result = TableBlockSchema.safeParse({ kind: "table", columns: ["A", "B"], rows: [["1"]] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 flashcards", () => {
    const broken = { kind: "flashcards", cards: Array.from({ length: 21 }, () => ({ front: "f", back: "b" })) };
    expect(FlashcardsBlockSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a practice question whose answer isn't one of its options", () => {
    const result = PracticeBlockSchema.safeParse({
      kind: "practice",
      questions: [{ stem: "2+2=?", options: ["1", "2", "3", "4"], answer: "5" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a practice question with duplicate options", () => {
    const result = PracticeBlockSchema.safeParse({
      kind: "practice",
      questions: [{ stem: "2+2=?", options: ["4", "4", "3", "1"], answer: "4" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 practice questions", () => {
    const question = { stem: "2+2=?", options: ["1", "2", "3", "4"], answer: "4" };
    const broken = { kind: "practice", questions: Array.from({ length: 11 }, () => question) };
    expect(PracticeBlockSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown callout tone", () => {
    expect(CalloutBlockSchema.safeParse({ kind: "callout", tone: "danger", text: "x" }).success).toBe(false);
  });

  it("rejects extra, unlisted fields on a block (strict)", () => {
    expect(BlockSchema.safeParse({ ...validNotes, extra: true }).success).toBe(false);
  });

  it("accepts a valid mindmap and chart block", () => {
    expect(
      MindmapBlockSchema.safeParse({
        kind: "mindmap",
        variant: "tree",
        nodes: [{ id: "root", parentId: null, label: "Root" }],
      }).success,
    ).toBe(true);
    expect(
      ChartBlockSchema.safeParse({
        kind: "chart",
        chartType: "bar",
        series: [{ name: "Term 1", points: [{ label: "Maths", value: 80 }] }],
      }).success,
    ).toBe(true);
  });

  it("rejects a mindmap node nested deeper than 4 levels", () => {
    const nodes = [
      { id: "n0", parentId: null, label: "n0" },
      { id: "n1", parentId: "n0", label: "n1" },
      { id: "n2", parentId: "n1", label: "n2" },
      { id: "n3", parentId: "n2", label: "n3" },
      { id: "n4", parentId: "n3", label: "n4" },
      { id: "n5", parentId: "n4", label: "n5" },
    ];
    expect(MindmapBlockSchema.safeParse({ kind: "mindmap", variant: "tree", nodes }).success).toBe(false);
  });

  it("rejects a mindmap with a parent cycle", () => {
    const nodes = [
      { id: "a", parentId: "b", label: "a" },
      { id: "b", parentId: "a", label: "b" },
    ];
    expect(MindmapBlockSchema.safeParse({ kind: "mindmap", variant: "tree", nodes }).success).toBe(false);
  });

  it("tolerates a dangling parentId at the schema level (buildTree drops it, not the schema)", () => {
    const nodes = [{ id: "orphan", parentId: "missing", label: "Orphan" }];
    expect(MindmapBlockSchema.safeParse({ kind: "mindmap", variant: "tree", nodes }).success).toBe(true);
  });

  it("rejects a pie chart with more than one series", () => {
    const result = ChartBlockSchema.safeParse({
      kind: "chart",
      chartType: "pie",
      series: [
        { name: "A", points: [{ label: "x", value: 1 }] },
        { name: "B", points: [{ label: "y", value: 2 }] },
      ],
    });
    expect(result.success).toBe(false);
  });
});
