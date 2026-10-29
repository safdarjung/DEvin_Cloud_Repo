// T-036, DBT-27 — `QuizGenerationSchema` must contain no `.refine()`
// anywhere in its tree (passed as a structured-output schema, `.refine()`
// crashes Ollama's model runner — reproduced in T-040's `ai:bench` run);
// `QuizContentSchema` (the strict parse the route applies to the result)
// still has its refinements, which is why they're parsed separately.
//
// Zod v4 does not wrap a refined schema in a different class (`.refine()`
// on a `ZodObject` stays a `ZodObject`) — it appends to that node's
// `_zod.def.checks` array. A built-in check (`.min()`, `.max()`,
// `.length()`) also lands in that array, tagged with its own `check` kind
// (e.g. `"min_length"`); only `.refine()`/`.superRefine()` checks are
// tagged `"custom"`. That tag is what this walker looks for — see the
// internals probed with `node -e` during T-036 to confirm this shape.
import { describe, expect, test } from "vitest";
import { GENERATION_MAX_STRING_LENGTH, QuizGenerationSchema, QuizRequestSchema } from "@/modules/ai/quiz.schemas";
import { QuizContentSchema } from "@/modules/academics/assignments.schemas";

interface ZodLikeCheck {
  _zod?: { def?: { check?: string; maximum?: number } };
}

interface ZodLikeDef {
  type?: string;
  checks?: ZodLikeCheck[];
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
}

interface ZodLike {
  _zod?: { def?: ZodLikeDef };
}

function assertNoRefinements(schema: unknown, path: string): void {
  const def = (schema as ZodLike)._zod?.def;
  if (!def) return;

  for (const check of def.checks ?? []) {
    if (check._zod?.def?.check === "custom") {
      throw new Error(`refinement (.refine()/.superRefine()) found at ${path}`);
    }
  }

  if (def.type === "object" && def.shape) {
    for (const [key, value] of Object.entries(def.shape)) {
      assertNoRefinements(value, `${path}.${key}`);
    }
  } else if (def.type === "array" && def.element) {
    assertNoRefinements(def.element, `${path}[]`);
  } else if ((def.type === "optional" || def.type === "nullable") && def.innerType) {
    assertNoRefinements(def.innerType, path);
  }
}

// Phase 1b (T-036-report.md "Phase 1b") — bisected against local Ollama
// 0.15.2 + qwen2.5:3b via raw `/api/chat`: a single string field's
// `maxLength` of 2000 generated correctly, 2010+ crashed the runner every
// time ("model runner has unexpectedly stopped"), independent of
// `.refine()`, array bounds, or nesting. This walker collects every
// `max_length` check in the tree so the regression test below can assert
// none of them is anywhere near that boundary.
function collectMaxLengths(schema: unknown, path: string, out: Array<{ path: string; maximum: number }>): void {
  const def = (schema as ZodLike)._zod?.def;
  if (!def) return;

  for (const check of def.checks ?? []) {
    if (check._zod?.def?.check === "max_length" && typeof check._zod.def.maximum === "number") {
      out.push({ path, maximum: check._zod.def.maximum });
    }
  }

  if (def.type === "object" && def.shape) {
    for (const [key, value] of Object.entries(def.shape)) {
      collectMaxLengths(value, `${path}.${key}`, out);
    }
  } else if (def.type === "array" && def.element) {
    collectMaxLengths(def.element, `${path}[]`, out);
  } else if ((def.type === "optional" || def.type === "nullable") && def.innerType) {
    collectMaxLengths(def.innerType, path, out);
  }
}

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    stem: "What is 2 + 2?",
    options: ["3", "4", "5", "6"],
    answer: "4",
    ...overrides,
  };
}

describe("QuizGenerationSchema (DBT-27) — refine-free twin of QuizContentSchema", () => {
  test("contains no refinement anywhere in its tree", () => {
    expect(() => assertNoRefinements(QuizGenerationSchema, "QuizGenerationSchema")).not.toThrow();
  });

  test("sanity check: QuizContentSchema (for contrast) DOES contain a refinement, so the walker actually detects one", () => {
    expect(() => assertNoRefinements(QuizContentSchema, "QuizContentSchema")).toThrow();
  });

  test("top-level shape keys match QuizContentSchema", () => {
    expect(Object.keys(QuizGenerationSchema.shape)).toEqual(Object.keys(QuizContentSchema.shape));
  });

  // Regression guard for the phase 1b crash: a string field with
  // `maxLength` >= ~2010 reliably crashed the local Ollama runner during
  // the bisect. Every `maxLength` in this schema must stay at or below
  // `GENERATION_MAX_STRING_LENGTH` (500, confirmed safe) with real margin
  // below the measured ~2000 boundary — this fails loudly if anyone raises
  // a field's cap back toward that line.
  test("no string field's maxLength exceeds GENERATION_MAX_STRING_LENGTH (crash threshold regression)", () => {
    const maxLengths: Array<{ path: string; maximum: number }> = [];
    collectMaxLengths(QuizGenerationSchema, "QuizGenerationSchema", maxLengths);

    expect(maxLengths.length).toBeGreaterThan(0); // the walker must actually find the fields
    for (const { path, maximum } of maxLengths) {
      expect(maximum, `${path} maxLength (${maximum}) exceeds GENERATION_MAX_STRING_LENGTH`).toBeLessThanOrEqual(
        GENERATION_MAX_STRING_LENGTH,
      );
    }
    expect(GENERATION_MAX_STRING_LENGTH).toBeLessThan(2000); // real margin below the measured crash boundary
  });

  test.each([
    ["one valid question", { questions: [validQuestion()] }],
    ["10 valid questions", { questions: Array.from({ length: 10 }, () => validQuestion()) }],
    ["30 valid questions (max)", { questions: Array.from({ length: 30 }, () => validQuestion()) }],
    ["question with optional explanation", { questions: [validQuestion({ explanation: "Because 2+2=4." })] }],
  ])("valid QuizContentSchema content also parses under QuizGenerationSchema: %s", (_label, input) => {
    expect(QuizContentSchema.safeParse(input).success).toBe(true);
    expect(QuizGenerationSchema.safeParse(input).success).toBe(true);
  });

  test.each([
    ["empty questions array (min 1)", { questions: [] }],
    ["31 questions (exceeds max 30)", { questions: Array.from({ length: 31 }, () => validQuestion()) }],
    ["unknown top-level key (strict)", { questions: [validQuestion()], extra: true }],
    ["only 3 options (needs exactly 4)", { questions: [validQuestion({ options: ["a", "b", "c"], answer: "a" })] }],
  ])("both schemas reject: %s", (_label, input) => {
    expect(QuizContentSchema.safeParse(input).success).toBe(false);
    expect(QuizGenerationSchema.safeParse(input).success).toBe(false);
  });

  // The whole point of the generation/strict split: a duplicate option or
  // an answer that isn't one of the options is NOT caught by the
  // refine-free generation schema (that's `QuizContentSchema`'s job, in
  // the route's second parse) — this documents that gap deliberately
  // rather than letting it be mistaken for a bug.
  test("duplicate options pass QuizGenerationSchema but fail QuizContentSchema", () => {
    const input = { questions: [validQuestion({ options: ["a", "a", "b", "c"], answer: "a" })] };
    expect(QuizGenerationSchema.safeParse(input).success).toBe(true);
    expect(QuizContentSchema.safeParse(input).success).toBe(false);
  });

  test("an answer not among the options passes QuizGenerationSchema but fails QuizContentSchema", () => {
    const input = { questions: [validQuestion({ answer: "not-an-option" })] };
    expect(QuizGenerationSchema.safeParse(input).success).toBe(true);
    expect(QuizContentSchema.safeParse(input).success).toBe(false);
  });
});

describe("QuizRequestSchema", () => {
  const base = {
    institutionSlug: "demo",
    curriculumUnitId: "11111111-1111-4111-8111-111111111111",
    questionCount: 10,
    difficulty: "medium" as const,
  };

  test("accepts a valid request", () => {
    expect(QuizRequestSchema.safeParse(base).success).toBe(true);
  });

  test("rejects questionCount below 5", () => {
    expect(QuizRequestSchema.safeParse({ ...base, questionCount: 4 }).success).toBe(false);
  });

  test("rejects questionCount above 15, with a field error on questionCount", () => {
    const result = QuizRequestSchema.safeParse({ ...base, questionCount: 50 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.questionCount).toBeDefined();
    }
  });

  test("rejects a non-integer questionCount", () => {
    expect(QuizRequestSchema.safeParse({ ...base, questionCount: 7.5 }).success).toBe(false);
  });

  test("rejects an invalid difficulty", () => {
    expect(QuizRequestSchema.safeParse({ ...base, difficulty: "impossible" }).success).toBe(false);
  });

  test("rejects a non-uuid curriculumUnitId", () => {
    expect(QuizRequestSchema.safeParse({ ...base, curriculumUnitId: "not-a-uuid" }).success).toBe(false);
  });

  test("rejects an unknown top-level key (strict)", () => {
    expect(QuizRequestSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});
