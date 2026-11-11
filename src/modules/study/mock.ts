// Mock exam (practice only): a timed paper across chosen units with sections
// by question type, run in the studio quiz runner. Pure: the model tags each
// question with the unit it covers; assembleMock keeps the section quotas and
// maps units; mockBreakdown scores per unit and per section after a run.
import { z } from "zod";
import { DIFFICULTIES, MockContentSchema, QuizGenerationQuestionSchema, QUIZ_TYPES, toQuizQuestion, type Difficulty, type MockContent, type QuizQuestion, type QuizType } from "@/modules/study/formats";
import type { Verdict } from "@/modules/study/quiz";

export { MockContentSchema, type MockContent };

export const MOCK_LENGTHS = [10, 15] as const;
export type MockLength = (typeof MOCK_LENGTHS)[number];
export const MOCK_DURATIONS = [15, 30, 45, 60, 90] as const;
export const MOCK_MAX_UNITS = 8;
export const SECTION_LABELS: Record<QuizType, string> = { mcq: "Multiple choice", true_false: "True or false", short: "Short answer" };
/** Units under this score are listed under "what to revise". */
export const REVISE_BELOW = 60;

/** Half multiple choice, a fifth short answer (at least one), the rest true/false. */
export function sectionPlan(count: number): Record<QuizType, number> {
  const mcq = Math.round(count * 0.5);
  const short = Math.max(1, Math.round(count * 0.2));
  return { mcq, true_false: count - mcq - short, short };
}

export const MockGenerationSchema = z
  .object({ questions: z.array(QuizGenerationQuestionSchema.extend({ unitNumber: z.number().int().min(0).max(20) })).min(1).max(20) })
  .strict();

export const MOCK_RULE =
  "Write a mock exam paper. Use only the requested question types and exactly the requested number of each. Spread " +
  "the questions across the listed units; set unitNumber to the number of the unit each question tests (0 if none). " +
  "For 'mcq' give exactly 4 different options and the 0-based index of the correct one. For 'true_false' set " +
  "answerTrue. For 'short' give a model answer of at most 60 words and 1 to 4 rubric points. Every question gets a " +
  "one-sentence explanation. Unused fields: empty string, empty list, -1 or false.";

export interface MockOptions {
  units: readonly { id: string; title: string }[];
  count: MockLength;
  difficulty: Difficulty;
  durationMinutes: number;
  examLabel: string | null;
  paperId: string | null;
}

export function assembleMock(raw: unknown, opts: MockOptions): { ok: true; content: MockContent } | { ok: false } {
  const gen = MockGenerationSchema.safeParse(raw);
  if (!gen.success) return { ok: false };
  const plan = sectionPlan(opts.count);
  const questions: QuizQuestion[] = [];
  const questionUnits: number[] = [];
  for (const type of QUIZ_TYPES) {
    let taken = 0;
    for (const q of gen.data.questions) {
      if (q.type !== type || taken >= plan[type]) continue;
      const mapped = toQuizQuestion(q);
      if (!mapped) continue;
      questions.push(mapped);
      questionUnits.push(q.unitNumber >= 1 && q.unitNumber <= opts.units.length ? q.unitNumber - 1 : -1);
      taken += 1;
    }
  }
  if (questions.length === 0) return { ok: false };
  const parsed = MockContentSchema.safeParse({
    difficulty: DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : "medium",
    durationMinutes: opts.durationMinutes,
    examLabel: opts.examLabel,
    paperId: opts.paperId,
    units: opts.units.map((u) => ({ id: u.id, title: u.title.slice(0, 200) })),
    questions,
    questionUnits,
  });
  return parsed.success ? { ok: true, content: parsed.data } : { ok: false };
}

export interface MockBreakdown {
  sections: { type: QuizType; label: string; correct: number; total: number }[];
  units: { unitId: string; title: string; correct: number; total: number; percent: number }[];
  /** Weakest first. */
  revise: { unitId: string; title: string; percent: number }[];
}

/**
 * Per section and per unit. MCQ and true/false score 1 each (unanswered = 0);
 * an AI-checked short answer scores its points / 2; short answers that were
 * not AI-checked (`aiChecks` empty) are left out rather than counted wrong.
 */
export function mockBreakdown(content: MockContent, verdicts: readonly Verdict[], aiChecks: readonly { score: number; feedback?: string }[]): MockBreakdown {
  const sections = new Map<QuizType, { correct: number; total: number }>();
  const units = new Map<number, { correct: number; total: number }>();
  let shortIndex = 0;
  content.questions.forEach((q, i) => {
    let correct: number;
    if (q.type === "short") {
      const check = aiChecks[shortIndex];
      shortIndex += 1;
      if (aiChecks.length === 0) return;
      correct = verdicts[i] === "ai_check" && check ? Math.min(2, Math.max(0, check.score)) / 2 : 0;
    } else {
      correct = verdicts[i] === "correct" ? 1 : 0;
    }
    const s = sections.get(q.type) ?? { correct: 0, total: 0 };
    sections.set(q.type, { correct: s.correct + correct, total: s.total + 1 });
    const unit = content.questionUnits[i] ?? -1;
    if (unit >= 0) {
      const u = units.get(unit) ?? { correct: 0, total: 0 };
      units.set(unit, { correct: u.correct + correct, total: u.total + 1 });
    }
  });
  const unitRows = [...units.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, u]) => ({ unitId: content.units[i]!.id, title: content.units[i]!.title, ...u, percent: Math.round((u.correct / u.total) * 100) }));
  return {
    sections: QUIZ_TYPES.flatMap((type) => {
      const s = sections.get(type);
      return s ? [{ type, label: SECTION_LABELS[type], ...s }] : [];
    }),
    units: unitRows,
    revise: unitRows
      .filter((u) => u.percent < REVISE_BELOW)
      .sort((a, b) => a.percent - b.percent || a.title.localeCompare(b.title))
      .map(({ unitId, title, percent }) => ({ unitId, title, percent })),
  };
}
