// Study help (0140) pure rules: weak-unit selection, mock exam assembly and
// scoring, worksheet levels, language variants, the file-reading gate.
import { describe, expect, it } from "vitest";
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_PDF_PAGES, countPdfPages, fileReadGate } from "@/lib/ai/file-input";
import { assembleMock, mockBreakdown, sectionPlan, type MockContent } from "@/modules/study/mock";
import { applyStrings, collectStrings } from "@/modules/study/variants";
import { selectWeakUnits, type UnitInfo } from "@/modules/study/weak-units";
import { WorksheetContentSchema, toWorksheet, worksheetAssignmentText } from "@/modules/study/worksheet";

const NOW = new Date("2026-11-11T06:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const allowed: UnitInfo[] = [1, 2, 3, 4, 5].map((n) => ({ id: U(n), title: `Unit ${n}`, subjectId: "s1", subjectName: "Science" }));

describe("selectWeakUnits", () => {
  it("orders by lowest accuracy first and caps at the limit", () => {
    const evidence = [
      { unitId: U(1), correct: 8, total: 10, at: daysAgo(1) },
      { unitId: U(2), correct: 2, total: 10, at: daysAgo(1) },
      { unitId: U(3), correct: 5, total: 10, at: daysAgo(1) },
      { unitId: U(4), correct: 4, total: 10, at: daysAgo(1) },
    ];
    const weak = selectWeakUnits({ allowed, evidence, mastery: [], now: NOW, limit: 2 });
    expect(weak.map((w) => w.unitId)).toEqual([U(2), U(4)]);
    expect(weak[0]!.accuracy).toBe(20);
  });

  it("never returns a unit outside the student's subjects", () => {
    const outside = "99999999-9999-4999-8999-999999999999";
    const weak = selectWeakUnits({ allowed, evidence: [{ unitId: outside, correct: 0, total: 20, at: daysAgo(1) }], mastery: [], now: NOW });
    expect(weak).toEqual([]);
  });

  it("needs a minimum of evidence before calling a unit weak", () => {
    const weak = selectWeakUnits({ allowed, evidence: [{ unitId: U(1), correct: 0, total: 3, at: daysAgo(1) }], mastery: [], now: NOW });
    expect(weak).toEqual([]);
  });

  it("weights recent answers above old ones", () => {
    // Unit 1: bad long ago, good lately. Unit 2: good long ago, bad lately.
    const evidence = [
      { unitId: U(1), correct: 0, total: 10, at: daysAgo(60) },
      { unitId: U(1), correct: 9, total: 10, at: daysAgo(1) },
      { unitId: U(2), correct: 10, total: 10, at: daysAgo(60) },
      { unitId: U(2), correct: 3, total: 10, at: daysAgo(1) },
    ];
    const weak = selectWeakUnits({ allowed, evidence, mastery: [], now: NOW });
    expect(weak.map((w) => w.unitId)).toEqual([U(2)]);
  });

  it("uses confident mastery snapshots as evidence and ignores unconfident ones", () => {
    const mastery = [
      { unitId: U(3), score: 0.3, confidence: 0.8, computedAt: daysAgo(2) },
      { unitId: U(4), score: 0.1, confidence: 0.2, computedAt: daysAgo(2) },
    ];
    const weak = selectWeakUnits({ allowed, evidence: [], mastery, now: NOW });
    expect(weak.map((w) => w.unitId)).toEqual([U(3)]);
  });

  it("is deterministic on ties (more evidence first, then title)", () => {
    const evidence = [
      { unitId: U(5), correct: 2, total: 4, at: daysAgo(0) },
      { unitId: U(1), correct: 5, total: 10, at: daysAgo(0) },
    ];
    const a = selectWeakUnits({ allowed, evidence, mastery: [], now: NOW });
    const b = selectWeakUnits({ allowed, evidence: [...evidence].reverse(), mastery: [], now: NOW });
    expect(a.map((w) => w.unitId)).toEqual([U(1), U(5)]);
    expect(b).toEqual(a);
  });
});

const gen = (type: "mcq" | "true_false" | "short", unitNumber: number, stem = `${type} q`) => ({
  type,
  stem,
  options: type === "mcq" ? ["a", "b", "c", "d"] : [],
  answerIndex: type === "mcq" ? 1 : -1,
  answerTrue: type === "true_false",
  modelAnswer: type === "short" ? "Because light reflects." : "",
  rubric: type === "short" ? ["reflects"] : [],
  explanation: "Why.",
  unitNumber,
});

describe("mock exam", () => {
  const units = [
    { id: U(1), title: "Light" },
    { id: U(2), title: "Sound" },
  ];
  const opts = { units, count: 10 as const, difficulty: "medium" as const, durationMinutes: 30, examLabel: "Term 1 — Science", paperId: null };

  it("plans sections MCQ, true/false and short answer that add up", () => {
    expect(sectionPlan(10)).toEqual({ mcq: 5, true_false: 3, short: 2 });
    expect(sectionPlan(15)).toEqual({ mcq: 8, true_false: 4, short: 3 });
  });

  it("orders questions by section, caps each section and maps units", () => {
    const raw = {
      questions: [gen("short", 1), gen("mcq", 2), gen("mcq", 1), gen("true_false", 9), ...Array.from({ length: 8 }, () => gen("mcq", 1)), gen("short", 2), gen("short", 2)],
    };
    const assembled = assembleMock(raw, opts);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const types = assembled.content.questions.map((q) => q.type);
    expect(types.filter((t) => t === "mcq")).toHaveLength(5);
    expect(types.filter((t) => t === "short")).toHaveLength(2);
    expect(types.indexOf("short")).toBeGreaterThan(types.lastIndexOf("mcq"));
    // unitNumber 9 is not a listed unit -> no unit.
    expect(assembled.content.questionUnits[types.indexOf("true_false")]).toBe(-1);
    expect(assembled.content.durationMinutes).toBe(30);
  });

  it("rejects output with no usable question", () => {
    expect(assembleMock({ questions: [{ ...gen("mcq", 1), options: ["a", "a", "b", "c"] }] }, opts).ok).toBe(false);
  });

  it("scores by unit and by section and lists what to revise", () => {
    const content: MockContent = {
      difficulty: "medium",
      durationMinutes: 30,
      examLabel: null,
      paperId: null,
      units,
      questions: [
        { type: "mcq", stem: "m1", options: ["a", "b", "c", "d"], answerIndex: 0, explanation: "" },
        { type: "mcq", stem: "m2", options: ["a", "b", "c", "d"], answerIndex: 0, explanation: "" },
        { type: "true_false", stem: "t1", answer: true, explanation: "" },
        { type: "short", stem: "s1", modelAnswer: "x", rubric: ["x"], explanation: "" },
      ],
      questionUnits: [0, 1, 1, 1],
    };
    const r = mockBreakdown(content, ["correct", "incorrect", "incorrect", "ai_check"], [{ score: 1, feedback: "ok" }]);
    expect(r.sections).toEqual([
      { type: "mcq", label: "Multiple choice", correct: 1, total: 2 },
      { type: "true_false", label: "True or false", correct: 0, total: 1 },
      { type: "short", label: "Short answer", correct: 0.5, total: 1 },
    ]);
    expect(r.units.find((u) => u.unitId === U(1))).toMatchObject({ correct: 1, total: 1, percent: 100 });
    expect(r.units.find((u) => u.unitId === U(2))).toMatchObject({ correct: 0.5, total: 3, percent: 17 });
    expect(r.revise.map((u) => u.unitId)).toEqual([U(2)]);
  });

  it("leaves unchecked short answers out of the totals", () => {
    const content: MockContent = {
      difficulty: "easy",
      durationMinutes: 15,
      examLabel: null,
      paperId: null,
      units,
      questions: [{ type: "short", stem: "s1", modelAnswer: "x", rubric: ["x"], explanation: "" }],
      questionUnits: [0],
    };
    expect(mockBreakdown(content, ["ai_check"], []).sections).toEqual([]);
  });
});

describe("worksheet", () => {
  const level = (l: "support" | "core" | "stretch") => ({ level: l, instructions: `Do the ${l} set.`, questions: [1, 2, 3].map((i) => ({ prompt: `${l} ${i}?`, answer: `ans ${i}` })) });

  it("needs exactly the three levels, each with questions and an answer key", () => {
    const ok = toWorksheet({ levels: [level("stretch"), level("support"), level("core")] });
    expect(ok.ok && ok.content.levels.map((l) => l.level)).toEqual(["support", "core", "stretch"]);
    expect(toWorksheet({ levels: [level("support"), level("core"), level("core")] }).ok).toBe(false);
    expect(WorksheetContentSchema.safeParse({ levels: [level("support"), level("core")] }).success).toBe(false);
    expect(WorksheetContentSchema.safeParse({ levels: [level("support"), level("core"), { ...level("stretch"), questions: [{ prompt: "p", answer: "" }] }] }).success).toBe(false);
  });

  it("homework text carries the questions of the chosen level and never the answers", () => {
    const parsed = toWorksheet({ levels: [level("support"), level("core"), level("stretch")] });
    if (!parsed.ok) throw new Error("fixture");
    const text = worksheetAssignmentText(parsed.content, "core");
    expect(text).toContain("core 1?");
    expect(text).not.toContain("support 1?");
    expect(text).not.toContain("ans 1");
    const all = worksheetAssignmentText(parsed.content, "all");
    expect(all).toContain("support 1?");
    expect(all).toContain("stretch 3?");
    expect(all).not.toContain("ans");
  });
});

describe("language variants", () => {
  const deck = { cards: [{ id: "c1", front: "Light", back: "A form of energy" }, { id: "c2", front: "Mirror", back: "Reflects light" }] };
  const quiz = { difficulty: "easy", questions: [{ type: "mcq", stem: "Q?", options: ["a", "b", "c", "d"], answerIndex: 2, explanation: "E" }, { type: "true_false", stem: "T?", answer: true, explanation: "" }] };

  it("collects only the text a reader sees, in a stable order", () => {
    expect(collectStrings(deck)).toEqual(["Light", "A form of energy", "Mirror", "Reflects light"]);
    expect(collectStrings(quiz)).toEqual(["Q?", "a", "b", "c", "d", "E", "T?"]);
  });

  it("writes translations back without touching ids, types, answers or difficulty", () => {
    const hi = applyStrings(quiz, ["प्र?", "क", "ख", "ग", "घ", "व्याख्या", "स?"]);
    expect(hi).toEqual({ difficulty: "easy", questions: [{ type: "mcq", stem: "प्र?", options: ["क", "ख", "ग", "घ"], answerIndex: 2, explanation: "व्याख्या" }, { type: "true_false", stem: "स?", answer: true, explanation: "" }] });
    expect(applyStrings(deck, ["one"])).toBeNull();
  });
});

describe("file-reading gate", () => {
  const base = { geminiKey: true, cloudSwitch: true, mime: "application/pdf", sizeBytes: 50_000, pages: 3 };

  it("allows a small PDF on Gemini with the cloud switch on", () => {
    expect(fileReadGate(base)).toEqual({ ok: true });
  });
  it("refuses when only a text-only provider is configured", () => {
    expect(fileReadGate({ ...base, geminiKey: false })).toMatchObject({ ok: false, code: "ai_unavailable" });
  });
  it("refuses an oversize file and a long PDF", () => {
    expect(fileReadGate({ ...base, sizeBytes: FILE_READ_MAX_BYTES + 1 })).toMatchObject({ ok: false, code: "validation_failed" });
    expect(fileReadGate({ ...base, pages: FILE_READ_MAX_PDF_PAGES + 1 })).toMatchObject({ ok: false, code: "validation_failed" });
  });
  it("refuses when the role's cloud switch is off", () => {
    expect(fileReadGate({ ...base, cloudSwitch: false })).toMatchObject({ ok: false, code: "ai_policy_blocked" });
  });
  it("refuses a type it cannot read", () => {
    expect(fileReadGate({ ...base, mime: "application/zip" })).toMatchObject({ ok: false, code: "validation_failed" });
  });
  it("counts PDF pages from the page tree", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 /Kids [2 0 R 3 0 R] >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>");
    expect(countPdfPages(pdf)).toBe(2);
    expect(countPdfPages(new TextEncoder().encode("%PDF-1.7 compressed"))).toBeNull();
  });
});
