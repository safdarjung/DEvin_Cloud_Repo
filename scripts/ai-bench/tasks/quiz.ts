// T-040 — quiz task: ≈300-token unit text -> 10-question QuizContentSchema.
//
// shortcut: this duplicates `QuizContentSchema` from
// `src/modules/academics/assignments.schemas.ts` instead of importing it.
// That file imports `@/lib/schemas/common`, and plain `node` (no bundler)
// cannot resolve the `@/` alias — the same reason `scripts/lib/admin-client.ts`
// duplicates its service-role guard instead of importing `src/lib/supabase/admin.ts`
// (see that file's header comment). Upgrade: if a path-alias loader is ever
// added for scripts, import the real schema instead and delete this copy.
// Keep this block byte-for-byte in sync with the source if it changes.
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { streamStructured, type StreamStructuredResult } from "../stream-structured.ts";
import type { LanguageModel } from "ai";

const quizOptionText = z.string().trim().min(1).max(500);

const QuizQuestionSchema = z
  .object({
    stem: z.string().trim().min(1).max(2000),
    options: z
      .array(quizOptionText)
      .length(4)
      .refine((options) => new Set(options).size === options.length, {
        message: "Options must be unique.",
      }),
    answer: quizOptionText,
    explanation: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine((q) => q.options.includes(q.answer), {
    message: "Answer must be one of the options.",
    path: ["answer"],
  });

export const QuizContentSchema = z
  .object({
    questions: z.array(QuizQuestionSchema).min(1).max(30),
  })
  .strict();

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export interface Fixture {
  id: string;
  text: string;
}

export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.startsWith("quiz-"))
    .sort()
    .map((f) => ({ id: f, text: readFileSync(join(FIXTURES_DIR, f), "utf8").trim() }));
}

function buildPrompt(unitText: string): string {
  return [
    "You are generating a 10-question multiple-choice quiz for the following curriculum unit.",
    "Each question must have exactly 4 unique options, and `answer` must be one of the 4 options verbatim.",
    "Respond with JSON only, matching the schema. Do not include markdown fences or commentary.",
    "",
    "Unit text:",
    unitText,
  ].join("\n");
}

export interface QuizRunResult extends StreamStructuredResult {
  isInjectionFixture: boolean;
  injectionObeyed: boolean;
  refusalDetected: boolean;
}

const REFUSAL_PATTERN = /\b(i\s*(cannot|can't|won't)|i'm\s*unable|as an ai)\b/i;

export async function runQuizTask(
  model: LanguageModel,
  fixture: Fixture,
  opts: { temperature: number; seed?: number; maxOutputTokens: number; abortSignal: AbortSignal },
): Promise<QuizRunResult> {
  const result = await streamStructured({
    model,
    schema: QuizContentSchema,
    prompt: buildPrompt(fixture.text),
    temperature: opts.temperature,
    seed: opts.seed,
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: opts.abortSignal,
  });

  return {
    ...result,
    isInjectionFixture: false, // no quiz fixture carries an injection (07 §5: only the summary fixture does)
    injectionObeyed: false,
    refusalDetected: REFUSAL_PATTERN.test(result.rawText),
  };
}
