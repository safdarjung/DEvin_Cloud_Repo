import { describe, expect, it } from "vitest";
import {
  QuestionCreateSchema,
  QuestionUpdateSchema,
  csvRowToQuestionInput,
  readableAnswer,
  type QuestionShape,
} from "../../src/modules/question-bank/schemas.ts";

const ids = {
  subjectId: "550e8400-e29b-41d4-a716-446655440002",
  gradeId: "550e8400-e29b-41d4-a716-446655440001",
};
const base = { ...ids, difficulty: "easy" as const, marks: 1, body: "Question body" };
const ok = (input: object) => QuestionCreateSchema.safeParse({ ...base, ...input }).success;

describe("question types — per-type answer/options shape", () => {
  it("multi_select: correct answers must be a subset of the options", () => {
    expect(ok({ type: "multi_select", options: ["a", "b", "c"], answerKey: ["a", "c"] })).toBe(true);
    expect(ok({ type: "multi_select", options: ["a", "b", "c"], answerKey: ["d"] })).toBe(false);
    expect(ok({ type: "multi_select", options: ["a", "b"], answerKey: [] })).toBe(false);
  });

  it("fill_blank: one answer per ___ blank", () => {
    expect(ok({ type: "fill_blank", body: "The capital of India is ___.", answerKey: ["New Delhi"] })).toBe(true);
    expect(ok({ type: "fill_blank", body: "___ and ___", answerKey: ["one"] })).toBe(false);
  });

  it("match: answer key maps every left item to a right index", () => {
    const options = { left: ["Dog", "Cat"], right: ["Meow", "Bark"] };
    expect(ok({ type: "match", options, answerKey: [1, 0] })).toBe(true);
    expect(ok({ type: "match", options, answerKey: [1] })).toBe(false);
    expect(ok({ type: "match", options, answerKey: [1, 5] })).toBe(false);
  });

  it("numerical: needs a finite value; tolerance defaults to 0", () => {
    const parsed = QuestionCreateSchema.parse({ ...base, type: "numerical", answerKey: { value: 9.8 } });
    expect(parsed.type === "numerical" && parsed.answerKey.tolerance).toBe(0);
    expect(ok({ type: "numerical", answerKey: { value: "9.8" } })).toBe(false);
  });

  it("assertion_reason: assertion + reason, answer A-D", () => {
    const options = { assertion: "Ice floats.", reason: "Ice is less dense than water." };
    expect(ok({ type: "assertion_reason", options, answer: "A" })).toBe(true);
    expect(ok({ type: "assertion_reason", options, answer: "E" })).toBe(false);
  });

  it("text types take a plain answer and no options", () => {
    for (const type of ["very_short_answer", "short_answer", "long_answer", "diagram"]) {
      expect(ok({ type, answer: "x" })).toBe(true);
      expect(ok({ type, answer: "x", options: ["a", "b"] })).toBe(false);
    }
  });

  it("passage and case_based stems may omit the answer", () => {
    expect(ok({ type: "passage" })).toBe(true);
    expect(ok({ type: "case_based" })).toBe(true);
  });

  it("origin defaults to manual; update does not accept origin", () => {
    const parsed = QuestionCreateSchema.parse({ ...base, type: "short_answer", answer: "x" });
    expect(parsed.origin).toBe("manual");
    const update = QuestionUpdateSchema.safeParse({ ...base, id: "550e8400-e29b-41d4-a716-446655440000", type: "short_answer", answer: "x", origin: "ai" });
    expect(update.success).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(ok({ type: "competency", answer: "x" })).toBe(false);
  });
});

describe("readableAnswer", () => {
  it("derives a readable answer from the key", () => {
    const parse = (input: object) => QuestionCreateSchema.parse({ ...base, ...input }) as QuestionShape;
    expect(readableAnswer(parse({ type: "multi_select", options: ["a", "b"], answerKey: ["a", "b"] }))).toBe("a; b");
    expect(readableAnswer(parse({ type: "match", options: { left: ["Dog", "Cat"], right: ["Meow", "Bark"] }, answerKey: [1, 0] }))).toBe(
      "Dog - Bark; Cat - Meow",
    );
    expect(readableAnswer(parse({ type: "numerical", answerKey: { value: 5, tolerance: 0.5, unit: "cm" } }))).toBe("5 (± 0.5) cm");
    expect(readableAnswer(parse({ type: "short_answer", answer: "kept" }))).toBe("kept");
  });
});

describe("csvRowToQuestionInput", () => {
  it("maps list cells and lower-cases type/difficulty/true_false", () => {
    const parse = (row: Record<string, string>) => QuestionCreateSchema.safeParse(csvRowToQuestionInput(row, ids.gradeId, ids.subjectId, undefined));
    const mcq = parse({ type: "MCQ", difficulty: "Easy", body: "2+2?", answer: "4", marks: "1", options: "3|4|5" });
    expect(mcq.success && mcq.data.origin).toBe("import");
    expect(parse({ type: "true_false", difficulty: "easy", body: "Sky is blue", answer: "TRUE", marks: "1" }).success).toBe(true);
    expect(parse({ type: "multi_select", difficulty: "easy", body: "Primes?", answer: "2|3", marks: "1", options: "2|3|4" }).success).toBe(true);
    expect(parse({ type: "numerical", difficulty: "easy", body: "g?", answer: "9.8", marks: "1", tolerance: "0.1" }).success).toBe(true);
    expect(parse({ type: "short_answer", difficulty: "easy", body: "Why?", answer: "Because", marks: "" }).success).toBe(false);
  });
});
