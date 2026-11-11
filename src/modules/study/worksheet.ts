// Teacher worksheet: the same topic at three levels (support / core /
// stretch), each with an answer key. Teacher-only (0140 check constraint);
// never shared to a section as material, because the key would reach
// students: homework gets the questions as text (worksheetAssignmentText).
import { z } from "zod";

export const WORKSHEET_LEVELS = ["support", "core", "stretch"] as const;
export type WorksheetLevel = (typeof WORKSHEET_LEVELS)[number];
export const LEVEL_LABELS: Record<WorksheetLevel, string> = { support: "Support", core: "Core", stretch: "Stretch" };

export const WORKSHEET_RULE =
  "Write a worksheet on the same topic at three levels, in this order: 'support' (scaffolded, recall and simple " +
  "one-step questions, with a hint in the question where useful), 'core' (the standard class level) and 'stretch' " +
  "(multi-step, application and reasoning). Each level has a one-line instruction for students and 3 to 8 questions; " +
  "every question has a short, correct answer for the teacher's answer key (at most 60 words). No multiple choice.";

const text = (max: number) => z.string().trim().min(1).max(max);
const question = z.object({ prompt: text(500), answer: text(600) }).strict();
const level = (min: number, max: number) =>
  z.object({ level: z.enum(WORKSHEET_LEVELS), instructions: text(300), questions: z.array(question).min(min).max(max) }).strict();

/** What the model must return (the provider schema). */
export const WorksheetGenerationSchema = z.object({ levels: z.array(level(3, 8)).min(3).max(3) }).strict();

const inOrder = (levels: readonly { level: WorksheetLevel }[]) => levels.map((l) => l.level).join() === WORKSHEET_LEVELS.join();

/** A saved (possibly teacher-edited) worksheet: the three levels in order, each with a key. */
export const WorksheetContentSchema = z
  .object({ levels: z.array(level(1, 12)).length(3) })
  .strict()
  .refine((w) => inOrder(w.levels), { message: "levels must be support, core and stretch", path: ["levels"] });
export type WorksheetContent = z.infer<typeof WorksheetContentSchema>;

/** Model output -> stored worksheet (levels put in order). Any missing or repeated level is rejected whole. */
export function toWorksheet(raw: unknown): { ok: true; content: WorksheetContent } | { ok: false } {
  const gen = WorksheetGenerationSchema.safeParse(raw);
  if (!gen.success) return { ok: false };
  const levels = [...gen.data.levels].sort((a, b) => WORKSHEET_LEVELS.indexOf(a.level) - WORKSHEET_LEVELS.indexOf(b.level));
  const stored = WorksheetContentSchema.safeParse({ levels });
  return stored.success ? { ok: true, content: stored.data } : { ok: false };
}

/** Plain-text homework for the assignment: questions only, never the answer key. */
export function worksheetAssignmentText(content: WorksheetContent, which: WorksheetLevel | "all"): string {
  const chosen = which === "all" ? content.levels : content.levels.filter((l) => l.level === which);
  return chosen
    .map((l) => [`${LEVEL_LABELS[l.level]} — ${l.instructions}`, ...l.questions.map((q, i) => `${i + 1}. ${q.prompt}`)].join("\n"))
    .join("\n\n")
    .slice(0, 5000);
}
