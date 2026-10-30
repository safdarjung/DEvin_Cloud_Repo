// T-036 — AI quiz generation schemas (06 §W6, DBT-27).
//
// `QuizGenerationSchema` is a twin of `QuizContentSchema` with (a) no
// cross-field `.refine()` and (b) every string field capped at
// `GENERATION_MAX_STRING_LENGTH` — see phase 1b below for why both matter.
// The route generates against this schema, then strict-parses the result
// with the real `QuizContentSchema` (which still enforces unique options,
// answer-is-one-of-options, and the real field limits up to 5000 chars) —
// a model that violates any of those fails that second parse and the route
// returns `ai_invalid_output`, the same code any other schema-validation
// failure produces.
//
// Phase 1b root cause (bisected against the local Ollama 0.15.2 install,
// `qwen2.5:3b`, via raw `/api/chat` requests with `options.num_predict` set
// — see `T-036-report.md` "Phase 1b" for the full ladder): `.refine()` was
// never the cause — a refine-free schema with `maxLength: 5000` on a
// single string field crashes the runner in ~0.2-6.5s with "model runner
// has unexpectedly stopped", reproduced even via raw `curl` with a
// hand-written JSON Schema (no Zod, no AI SDK at all). Bisecting the exact
// field found: 2000 chars is safe, 2010+ consistently crashes — i.e. the
// JSON-Schema-to-grammar compiler blows up once a single field's
// `maxLength` crosses roughly ~2000, independent of nesting or array
// bounds (`minItems`/`maxItems` alone, and small-maxLength nested arrays
// of objects, both generate correctly). `GENERATION_MAX_STRING_LENGTH` is
// set well below that measured boundary for margin across hosts/versions.
//
// Must not modify `src/lib/ai/**` (lead ruling) and must stay in the
// fields `QuizContentSchema` defines, with intentionally relaxed limits
// (phase 1b ruling) — `tests/unit/quiz-schema.test.ts` checks: no
// refinements, parity with valid `QuizContentSchema` content, and no
// string field's `maxLength` exceeds the safe threshold.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export { QuizContentSchema } from "@/modules/academics/assignments.schemas";
export type { QuizContent } from "@/modules/academics/assignments.schemas";

// Confirmed safe at 500 (test "3-maxLength-500" in the phase 1b bisect);
// confirmed crashing at 2010+. `QuizContentSchema`'s own limits (2000 for
// `stem`, 5000 for `explanation`) still apply on the real parse after
// generation — this only bounds what we ask the MODEL to produce.
export const GENERATION_MAX_STRING_LENGTH = 500;

const quizOptionText = z.string().trim().min(1).max(GENERATION_MAX_STRING_LENGTH);

// Exported for reuse by the generative-UI "practice" block (D31,
// src/modules/ai/blocks/schemas.ts), which the plan specs as "same shape
// as QuizContentSchema" at generation-safe (DBT-27) caps — this IS that
// shape, not a second copy of it.
export const QuizGenerationQuestionSchema = z
  .object({
    stem: z.string().trim().min(1).max(GENERATION_MAX_STRING_LENGTH),
    options: z.array(quizOptionText).length(4),
    answer: quizOptionText,
    explanation: z.string().trim().max(GENERATION_MAX_STRING_LENGTH).optional(),
  })
  .strict();

export const QuizGenerationSchema = z
  .object({
    questions: z.array(QuizGenerationQuestionSchema).min(1).max(30),
  })
  .strict();

export type QuizGenerationContent = z.infer<typeof QuizGenerationSchema>;

export const QuizRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    curriculumUnitId: uuid,
    questionCount: z.number().int().min(5).max(15),
    difficulty: z.enum(["easy", "medium", "hard"]),
  })
  .strict();

export type QuizRequestInput = z.infer<typeof QuizRequestSchema>;
