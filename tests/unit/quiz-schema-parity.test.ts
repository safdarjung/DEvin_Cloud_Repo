// T-040 fix round 1 (code review, MEDIUM) — `scripts/ai-bench/tasks/quiz.ts`
// duplicates `QuizContentSchema` because plain Node can't resolve the `@/`
// alias (see that file's header comment). This test runs under Vitest,
// which DOES resolve `@/` (vite-tsconfig-paths), so it can import the real
// source schema and the bench's duplicate side by side and catch drift.
import { describe, expect, test } from "vitest";
import { QuizContentSchema as SourceSchema } from "@/modules/academics/assignments.schemas";
import { QuizContentSchema as BenchSchema } from "../../scripts/ai-bench/tasks/quiz.ts";

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    stem: "What is 2 + 2?",
    options: ["3", "4", "5", "6"],
    answer: "4",
    ...overrides,
  };
}

describe("QuizContentSchema parity: scripts/ai-bench/tasks/quiz.ts vs src/modules/academics/assignments.schemas.ts", () => {
  test("top-level shape keys match", () => {
    expect(Object.keys(BenchSchema.shape)).toEqual(Object.keys(SourceSchema.shape));
  });

  test.each([
    ["one valid question", { questions: [validQuestion()] }],
    ["30 valid questions (max)", { questions: Array.from({ length: 30 }, () => validQuestion()) }],
    ["question with optional explanation", { questions: [validQuestion({ explanation: "Because 2+2=4." })] }],
    ["stem at max length 2000", { questions: [validQuestion({ stem: "x".repeat(2000) })] }],
    ["option at max length 500", { questions: [validQuestion({ options: ["a".repeat(500), "b", "c", "d"], answer: "a".repeat(500) })] }],
    ["explanation at max length 5000", { questions: [validQuestion({ explanation: "x".repeat(5000) })] }],
  ])("both schemas accept: %s", (_label, input) => {
    expect(SourceSchema.safeParse(input).success).toBe(true);
    expect(BenchSchema.safeParse(input).success).toBe(true);
  });

  test.each([
    ["empty questions array (min 1)", { questions: [] }],
    ["31 questions (exceeds max 30)", { questions: Array.from({ length: 31 }, () => validQuestion()) }],
    ["missing answer field", { questions: [{ stem: "s", options: ["a", "b", "c", "d"] }] }],
    ["unknown top-level key (strict)", { questions: [validQuestion()], extra: true }],
    ["unknown question key (strict)", { questions: [{ ...validQuestion(), extra: true }] }],
    ["duplicate options", { questions: [validQuestion({ options: ["a", "a", "b", "c"], answer: "a" })] }],
    ["answer not among options", { questions: [validQuestion({ answer: "not-an-option" })] }],
    ["only 3 options (needs exactly 4)", { questions: [validQuestion({ options: ["a", "b", "c"], answer: "a" })] }],
    ["5 options (needs exactly 4)", { questions: [validQuestion({ options: ["a", "b", "c", "d", "e"], answer: "a" })] }],
    ["stem over max length 2000", { questions: [validQuestion({ stem: "x".repeat(2001) })] }],
    ["option over max length 500", { questions: [validQuestion({ options: ["a".repeat(501), "b", "c", "d"], answer: "a".repeat(501) })] }],
    ["explanation over max length 5000", { questions: [validQuestion({ explanation: "x".repeat(5001) })] }],
    ["empty stem", { questions: [validQuestion({ stem: "" })] }],
  ])("both schemas reject: %s", (_label, input) => {
    expect(SourceSchema.safeParse(input).success).toBe(false);
    expect(BenchSchema.safeParse(input).success).toBe(false);
  });
});
