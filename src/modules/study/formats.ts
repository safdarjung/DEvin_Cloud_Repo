// Study studio formats: ten summary formats plus a mixed quiz. Each format has
// its own structure (a strict Zod schema), its own length rules for the model
// (FORMAT_RULES) and is generated on its own, never cut from another format.
// generationSchema(f) enforces the format's full size; contentSchema(f) is
// what a saved (possibly hand-edited, shortened) copy must satisfy.
import { z } from "zod";

export const SUMMARY_FORMATS = [
  "quick_summary",
  "revision_notes",
  "cheat_sheet",
  "key_concepts",
  "glossary",
  "high_yield",
  "exam_notes",
  "one_page",
  "active_recall",
  "flashcards",
] as const;
export const STUDY_FORMATS = [...SUMMARY_FORMATS, "quiz"] as const;
export type StudyFormat = (typeof STUDY_FORMATS)[number];

export const QUIZ_TYPES = ["mcq", "true_false", "short"] as const;
export type QuizType = (typeof QUIZ_TYPES)[number];
export const QUIZ_LENGTHS = [5, 10, 15] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const FORMAT_LABELS: Record<StudyFormat, string> = {
  quick_summary: "Quick summary",
  revision_notes: "Revision notes",
  cheat_sheet: "Cheat sheet",
  key_concepts: "Key concepts",
  glossary: "Definitions",
  high_yield: "High-yield points",
  exam_notes: "Exam notes",
  one_page: "One-page summary",
  active_recall: "Active recall",
  flashcards: "Flashcard deck",
  quiz: "Quiz",
};

export const FORMAT_RULES: Record<StudyFormat, string> = {
  quick_summary: "Write a quick summary: one plain paragraph of at most 120 words, then 3 to 5 key points of one sentence each.",
  revision_notes:
    "Write revision notes: 2 to 8 sections in teaching order, each with a short heading and 1 to 8 bullet points of at most 30 words.",
  cheat_sheet:
    "Write a cheat sheet: 6 to 20 compact items, each a short label (a term, formula name or rule) and a detail of at most 25 words. Formulas in plain text.",
  key_concepts:
    "Write key concepts: 3 to 10 core ideas, each with a name, an explanation of at most 60 words and one concrete everyday or worked example.",
  glossary: "Write a glossary: 5 to 30 subject terms in alphabetical order, each with a precise, student-level definition of at most 35 words.",
  high_yield:
    "Write high-yield points: the 5 to 12 facts most likely to be tested, each one sentence, with a short reason why it matters or is often asked.",
  exam_notes:
    "Write exam notes: 3 to 8 likely exam questions, each with a step-by-step answer outline of 1 to 6 short steps, then 1 to 6 common mistakes to avoid.",
  one_page:
    "Write a one-page summary that fits on one printed page: an overview of at most 70 words, 2 to 5 headed sections of 1 to 5 bullets, and one line to remember.",
  active_recall:
    "Write active-recall prompts: 5 to 15 questions that make the student retrieve an idea from memory (why, how, compare, explain), each with a model answer of at most 60 words.",
  flashcards:
    "Write a flashcard deck: 6 to 40 cards; each front is a short cue or question (at most 20 words), each back a precise answer (at most 40 words). One fact per card.",
  quiz:
    "Write a practice quiz with exactly the requested number of questions, using only the requested question types. For 'mcq' give exactly 4 different options and the 0-based index of the correct one. For 'true_false' set answerTrue. For 'short' give a model answer of at most 60 words and 1 to 4 rubric points a correct answer must contain. Every question gets a one-sentence explanation. Unused fields: empty string, empty list, -1 or false.",
};

const text = (max: number) => z.string().trim().min(1).max(max);
const list = <T extends z.ZodTypeAny>(item: T, min: number, max: number, full: boolean) => z.array(item).min(full ? min : 1).max(max);

function summarySchemas(full: boolean) {
  return {
    quick_summary: z.object({ summary: text(1200), keyPoints: list(text(200), 3, 5, full) }).strict(),
    revision_notes: z
      .object({ sections: list(z.object({ heading: text(120), points: list(text(300), 1, 8, full) }).strict(), 2, 8, full) })
      .strict(),
    cheat_sheet: z.object({ items: list(z.object({ label: text(80), detail: text(200) }).strict(), 6, 20, full) }).strict(),
    key_concepts: z
      .object({ concepts: list(z.object({ name: text(100), explanation: text(500), example: text(300) }).strict(), 3, 10, full) })
      .strict(),
    glossary: z.object({ terms: list(z.object({ term: text(80), definition: text(300) }).strict(), 5, 30, full) }).strict(),
    high_yield: z.object({ points: list(z.object({ point: text(250), why: text(200) }).strict(), 5, 12, full) }).strict(),
    exam_notes: z
      .object({
        likelyQuestions: list(z.object({ question: text(300), answerOutline: list(text(250), 1, 6, full) }).strict(), 3, 8, full),
        commonMistakes: list(text(200), 1, 6, full),
      })
      .strict(),
    one_page: z
      .object({
        overview: text(600),
        sections: list(z.object({ heading: text(120), bullets: list(text(200), 1, 5, full) }).strict(), 2, 5, full),
        remember: text(300),
      })
      .strict(),
    active_recall: z.object({ prompts: list(z.object({ prompt: text(300), answer: text(500) }).strict(), 5, 15, full) }).strict(),
  };
}

const GENERATION = summarySchemas(true);
const STORED = summarySchemas(false);

const cardText = { front: text(200), back: text(400) };
const FlashcardGenerationSchema = z.object({ cards: z.array(z.object(cardText).strict()).min(6).max(40) }).strict();
export const FlashcardSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), ...cardText }).strict();
const FlashcardDeckSchema = z
  .object({ cards: z.array(FlashcardSchema).min(1).max(60) })
  .strict()
  .refine((d) => new Set(d.cards.map((c) => c.id)).size === d.cards.length, { message: "card ids must be unique", path: ["cards"] });
export type Flashcard = z.infer<typeof FlashcardSchema>;

// Quiz: the model fills a flat, every-key-present frame; toStoredContent maps
// it onto the typed question union and drops anything malformed.
const QuizGenerationQuestionSchema = z
  .object({
    type: z.enum(QUIZ_TYPES),
    stem: text(500),
    options: z.array(text(200)).max(4),
    answerIndex: z.number().int().min(-1).max(3),
    answerTrue: z.boolean(),
    modelAnswer: z.string().trim().max(600),
    rubric: z.array(text(200)).max(4),
    explanation: z.string().trim().max(500),
  })
  .strict();
const QuizGenerationSchema = z.object({ questions: z.array(QuizGenerationQuestionSchema).min(1).max(15) }).strict();

const explanation = z.string().trim().max(500);
export const QuizQuestionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), stem: text(500), options: z.array(text(200)).length(4), answerIndex: z.number().int().min(0).max(3), explanation }).strict(),
  z.object({ type: z.literal("true_false"), stem: text(500), answer: z.boolean(), explanation }).strict(),
  z.object({ type: z.literal("short"), stem: text(500), modelAnswer: text(600), rubric: z.array(text(200)).min(1).max(4), explanation }).strict(),
]);
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
const QuizContentSchema = z.object({ difficulty: z.enum(DIFFICULTIES), questions: z.array(QuizQuestionSchema).min(1).max(15) }).strict();

/** What the model must return for `format`. */
export function generationSchema(format: StudyFormat): z.ZodType<unknown> {
  if (format === "flashcards") return FlashcardGenerationSchema;
  if (format === "quiz") return QuizGenerationSchema;
  return GENERATION[format];
}

/** What a saved copy (after teacher/student edits) must satisfy. */
export function contentSchema(format: StudyFormat): z.ZodType<unknown> {
  if (format === "flashcards") return FlashcardDeckSchema;
  if (format === "quiz") return QuizContentSchema;
  return STORED[format];
}

export interface QuizOptions {
  quizTypes?: readonly QuizType[];
  quizCount?: number;
  difficulty?: Difficulty;
}

const distinct = (values: readonly string[]): boolean => new Set(values.map((v) => v.trim().toLowerCase())).size === values.length;

function toQuizQuestion(q: z.infer<typeof QuizGenerationQuestionSchema>): QuizQuestion | null {
  const explanationText = q.explanation;
  if (q.type === "mcq") {
    if (q.options.length !== 4 || !distinct(q.options) || q.answerIndex < 0) return null;
    return { type: "mcq", stem: q.stem, options: q.options, answerIndex: q.answerIndex, explanation: explanationText };
  }
  if (q.type === "true_false") return { type: "true_false", stem: q.stem, answer: q.answerTrue, explanation: explanationText };
  if (!q.modelAnswer || q.rubric.length === 0) return null;
  return { type: "short", stem: q.stem, modelAnswer: q.modelAnswer, rubric: q.rubric, explanation: explanationText };
}

/** Model output -> stored content for `format`, validated whole. Invalid output is rejected, never partly saved. */
export function toStoredContent(format: StudyFormat, raw: unknown, opts: QuizOptions): { ok: true; content: unknown } | { ok: false } {
  const gen = generationSchema(format).safeParse(raw);
  if (!gen.success) return { ok: false };
  let content: unknown = gen.data;
  if (format === "flashcards") {
    content = { cards: (gen.data as z.infer<typeof FlashcardGenerationSchema>).cards.map((c, i) => ({ id: `c${i + 1}`, ...c })) };
  } else if (format === "quiz") {
    const allowed = new Set(opts.quizTypes ?? QUIZ_TYPES);
    const questions = (gen.data as z.infer<typeof QuizGenerationSchema>).questions
      .filter((q) => allowed.has(q.type))
      .map(toQuizQuestion)
      .filter((q): q is QuizQuestion => q !== null)
      .slice(0, opts.quizCount ?? 15);
    if (questions.length === 0) return { ok: false };
    content = { difficulty: opts.difficulty ?? "medium", questions };
  }
  const stored = contentSchema(format).safeParse(content);
  return stored.success ? { ok: true, content: stored.data } : { ok: false };
}
