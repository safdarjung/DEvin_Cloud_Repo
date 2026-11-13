import { describe, expect, it } from "vitest";
import { arrangeSet, renderPaperHtml } from "@/modules/question-papers/html";
import { sectionMarks, seededShuffle } from "@/modules/question-papers/paper-math";
import type { PaperDetail, PaperItem } from "@/modules/question-papers/queries";
import { BlueprintSchema } from "@/modules/question-papers/schemas";

const item = (id: string, overrides: Partial<PaperItem> = {}): PaperItem => ({
  id,
  sectionId: "s1",
  position: 0,
  sourceQuestionId: null,
  type: "short_answer",
  body: `Question ${id}`,
  options: null,
  answer: `Answer ${id}`,
  answerKey: null,
  marks: 2,
  explanation: null,
  markingScheme: null,
  difficulty: "easy",
  curriculumUnitId: null,
  curriculumTopicId: null,
  sourceSubjectTextbookId: null,
  sourceChapterNo: null,
  sourcePage: null,
  choiceGroup: null,
  ...overrides,
});

function paper(items: PaperItem[], overrides: Partial<PaperDetail> = {}): PaperDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Maths <Unit> Test",
    status: "approved",
    academicYearId: "y",
    gradeId: "g",
    gradeCode: "VIII",
    subjectId: "m",
    subjectName: "Mathematics",
    sectionId: null,
    examId: null,
    examName: "Unit Test 1",
    examPaperId: null,
    examType: null,
    examDate: "2026-12-01",
    totalMarks: 10,
    currentVersion: 1,
    revisionOfId: null,
    createdBy: "u",
    updatedAt: "",
    passMarks: 4,
    durationMinutes: 60,
    instructions: "All questions are compulsory.\nUse a pen.",
    negativeMarking: 0,
    blueprint: null,
    templateId: null,
    approvedBy: null,
    approvedAt: null,
    publishedAt: null,
    sections: [{ id: "s1", title: "Section A", instructions: null, position: 0, chooseCount: null, items }],
    ...overrides,
  };
}

describe("seededShuffle", () => {
  it("gives the same order for the same seed and a different order for another seed", () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(list, "paper:B")).toEqual(seededShuffle(list, "paper:B"));
    expect(seededShuffle(list, "paper:B")).not.toEqual(seededShuffle(list, "paper:C"));
    expect([...seededShuffle(list, "paper:B")].sort((a, b) => a - b)).toEqual(list);
  });
});

describe("sectionMarks (choice math, mirrors app.validate_paper)", () => {
  it("counts an OR pair once at its higher mark", () => {
    expect(sectionMarks([{ marks: 2, choiceGroup: 1 }, { marks: 3, choiceGroup: 1 }, { marks: 2, choiceGroup: null }], null)).toBe(5);
  });

  it("keeps only the best N slots of an attempt-any section", () => {
    expect(sectionMarks([{ marks: 5, choiceGroup: null }, { marks: 5, choiceGroup: null }, { marks: 5, choiceGroup: null }], 2)).toBe(10);
    expect(sectionMarks([{ marks: 1, choiceGroup: null }, { marks: 4, choiceGroup: 7 }, { marks: 4, choiceGroup: 7 }], 1)).toBe(4);
  });
});

describe("renderPaperHtml", () => {
  it("escapes every user value", () => {
    const html = renderPaperHtml({
      schoolName: `<script>alert(1)</script> School`,
      logoUrl: null,
      paper: paper([item("a", { body: `<img src=x onerror=alert(1)> "quoted"` })]),
      kind: "paper",
      set: "A",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot;");
    expect(html).toContain("Maths &lt;Unit&gt; Test");
  });

  it("prints superscripts, OR between choices, marks and candidate boxes", () => {
    const html = renderPaperHtml({
      schoolName: "School",
      logoUrl: null,
      paper: paper([item("a", { body: "Expand (x+1)^2", choiceGroup: 1 }), item("b", { choiceGroup: 1 })]),
      kind: "paper",
      set: "A",
    });
    expect(html).toContain("Expand (x+1)²");
    expect(html).toContain(`<div class="or">OR</div>`);
    expect(html).toContain("[2]");
    expect(html).toContain("Roll no.");
    expect(html).toContain("<li>Use a pen.</li>");
  });

  it("set B shuffles MCQ options and its answer key follows the shuffle", () => {
    const options = ["2", "3", "4", "5", "6", "7"];
    const p = paper(Array.from({ length: 6 }, (_, i) => item(`q${i}`, { type: "mcq", options, answer: "4", marks: 1 })));
    const setB = arrangeSet(p, "B");
    const firstB = setB[0].slots[0].items[0];
    expect(arrangeSet(p, "A")[0].slots.map((s) => s.items[0].id)).toEqual(["q0", "q1", "q2", "q3", "q4", "q5"]);
    expect(arrangeSet(p, "B")).toEqual(setB);
    const key = renderPaperHtml({ schoolName: "S", logoUrl: null, paper: p, kind: "key", set: "B" });
    const letter = String.fromCharCode(97 + (firstB.shownOptions as string[]).indexOf("4"));
    expect(key).toContain(`<b>Answer:</b> (${letter}) 4`);
    expect(key).not.toContain("Roll no.");
  });
});

describe("arrangeSet keeps passage / case stems with their sub-questions", () => {
  it("every set prints a stem followed by its children, in their built order", () => {
    const items = [
      item("x1"),
      item("stem", { type: "passage", sourceQuestionId: "S", answer: null }),
      item("c1", { stemSourceId: "S" }),
      item("c2", { stemSourceId: "S" }),
      item("x2"),
      item("x3"),
      item("x4", { choiceGroup: 1 }),
      item("x5", { choiceGroup: 1 }),
      item("x6"),
      item("x7"),
    ];
    for (const set of ["A", "B", "C", "D"] as const) {
      const order = arrangeSet(paper(items), set)[0].slots.map((s) => s.items[0].id);
      const at = order.indexOf("stem");
      expect(order.slice(at, at + 3), `set ${set}`).toEqual(["stem", "c1", "c2"]);
      expect(order).toHaveLength(9);
    }
  });
});

describe("BlueprintSchema", () => {
  it("accepts a school-defined blueprint and rejects unknown keys", () => {
    const bp = { sections: [{ title: "A", chooseCount: 4, rows: [{ type: "mcq", count: 5, marks: 1, difficulty: "easy" }] }], difficultyMix: { easy: 40 } };
    expect(BlueprintSchema.safeParse(bp).success).toBe(true);
    expect(BlueprintSchema.safeParse({ ...bp, board: "CBSE" }).success).toBe(false);
  });
});
