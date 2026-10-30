// D31 (12-decision-log.md) — the generative-UI block catalog
// (`14-generative-ui-plan.md` §4): a closed, Zod-validated set of block
// `kind`s the model may emit, shared by the student study chat and the
// teacher agent. No block kind renders markup the model wrote — every
// field here is a plain, capped string/number/enum, never HTML or
// markdown, so `BlockRenderer` never needs `dangerouslySetInnerHTML`.
//
// Every string field is capped well under DBT-27's measured ~2000-char
// Ollama grammar-compiler crash boundary (`GENERATION_MAX_STRING_LENGTH`,
// quiz.schemas.ts) — this catalog must work for the local model, not only
// cloud ones. Lists are flat, never recursive (mindmap's `parentId` is a
// flat adjacency reference, not nesting), because recursive schemas are
// fragile across Gemini/Groq/Ollama structured output (plan §4).
//
// GU-03 added five kinds (notes, table, flashcards, practice, callout);
// GU-04 adds `mindmap` and `chart` below, completing the 7-kind catalog.
import { z } from "zod";
import { QuizGenerationQuestionSchema } from "@/modules/ai/quiz.schemas";

const heading = z.string().trim().min(1).max(120);
const bullet = z.string().trim().min(1).max(300);
const example = z.string().trim().min(1).max(500);
const cardText = z.string().trim().min(1).max(300);
const cardFront = z.string().trim().min(1).max(200);
const cell = z.string().trim().max(120);

const NotesSectionSchema = z
  .object({
    heading,
    bullets: z.array(bullet).min(1).max(12),
    example: example.optional(),
  })
  .strict();

export const NotesBlockSchema = z
  .object({
    kind: z.literal("notes"),
    sections: z.array(NotesSectionSchema).min(1).max(10),
  })
  .strict();

export const TableBlockSchema = z
  .object({
    kind: z.literal("table"),
    columns: z.array(heading).min(1).max(6),
    rows: z.array(z.array(cell)).min(1).max(40),
  })
  .strict()
  .refine((block) => block.rows.every((row) => row.length === block.columns.length), {
    message: "Every row must have exactly one cell per column.",
    path: ["rows"],
  });

export const FlashcardsBlockSchema = z
  .object({
    kind: z.literal("flashcards"),
    cards: z
      .array(z.object({ front: cardFront, back: cardText }).strict())
      .min(1)
      .max(20),
  })
  .strict();

// "Same shape as QuizContentSchema" (plan §4) at generation-safe caps —
// `QuizGenerationQuestionSchema` IS that shape, reused, not re-specified.
// Never saved to `assignments` — practice is scratch-only, rule 6 (AI
// output is a suggestion, never a graded artifact on its own).
//
// Review finding (HIGH): `QuizGenerationQuestionSchema` deliberately skips
// the "answer is one of options" / uniqueness checks that
// `QuizContentSchema` enforces (quiz.schemas.ts's own comment) — the quiz
// route compensates with a second strict parse before use; this schema
// has no such second pass, so the check belongs here instead.
export const PracticeBlockSchema = z
  .object({
    kind: z.literal("practice"),
    questions: z.array(QuizGenerationQuestionSchema).min(1).max(10),
  })
  .strict()
  .superRefine((block, ctx) => {
    block.questions.forEach((question, index) => {
      if (new Set(question.options).size !== question.options.length) {
        ctx.addIssue({ code: "custom", message: "Options must be unique.", path: ["questions", index, "options"] });
      }
      if (!question.options.includes(question.answer)) {
        ctx.addIssue({
          code: "custom",
          message: "Answer must be one of the options.",
          path: ["questions", index, "answer"],
        });
      }
    });
  });

export const CalloutBlockSchema = z
  .object({
    kind: z.literal("callout"),
    tone: z.enum(["info", "tip", "warning"]),
    text: cardText,
  })
  .strict();

// GU-04. A flat adjacency list, not a nested tree — recursive schemas are
// fragile across Gemini/Groq/Ollama structured output (plan §4). A node
// whose `parentId` doesn't resolve to another node in the same block is
// NOT rejected here: `mindmap-layout.ts`'s `buildTree` drops it instead
// (a model producing one bad reference in an otherwise-good mindmap
// shouldn't lose the whole block). Depth IS enforced here, by walking
// each node's resolvable parent chain.
const MindmapNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    parentId: z.string().trim().min(1).max(50).nullable(),
    label: z.string().trim().min(1).max(80),
    detail: example.optional(),
  })
  .strict();

const MAX_MINDMAP_DEPTH = 4;

export const MindmapBlockSchema = z
  .object({
    kind: z.literal("mindmap"),
    variant: z.enum(["tree", "radial", "outline", "parts"]),
    nodes: z.array(MindmapNodeSchema).min(1).max(60),
  })
  .strict()
  .superRefine((block, ctx) => {
    const byId = new Map(block.nodes.map((node) => [node.id, node]));
    for (const start of block.nodes) {
      const seen = new Set<string>([start.id]);
      let depth = 0;
      let parentId = start.parentId;
      while (parentId !== null) {
        if (seen.has(parentId)) {
          ctx.addIssue({ code: "custom", message: `Mindmap has a cycle at node "${start.id}".`, path: ["nodes"] });
          return;
        }
        const parent = byId.get(parentId);
        if (!parent) break; // dangling parentId — tolerated here, dropped by buildTree
        seen.add(parent.id);
        depth++;
        if (depth > MAX_MINDMAP_DEPTH) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${start.id}" is deeper than the max depth of ${MAX_MINDMAP_DEPTH}.`,
            path: ["nodes"],
          });
          return;
        }
        parentId = parent.parentId;
      }
    }
  });

const chartLabel = z.string().trim().min(1).max(80);

const ChartPointSchema = z.object({ label: chartLabel, value: z.number() }).strict();

const ChartSeriesSchema = z
  .object({
    name: chartLabel,
    points: z.array(ChartPointSchema).min(1).max(50),
  })
  .strict();

export const ChartBlockSchema = z
  .object({
    kind: z.literal("chart"),
    chartType: z.enum(["bar", "line", "pie", "area"]),
    unit: z.string().trim().min(1).max(30).optional(),
    series: z.array(ChartSeriesSchema).min(1).max(4),
  })
  .strict()
  .refine((block) => block.chartType !== "pie" || block.series.length === 1, {
    message: "A pie chart takes exactly one series.",
    path: ["series"],
  });

export const BlockSchema = z.discriminatedUnion("kind", [
  NotesBlockSchema,
  TableBlockSchema,
  FlashcardsBlockSchema,
  PracticeBlockSchema,
  CalloutBlockSchema,
  MindmapBlockSchema,
  ChartBlockSchema,
]);

export type Block = z.infer<typeof BlockSchema>;
export type NotesBlock = z.infer<typeof NotesBlockSchema>;
export type TableBlock = z.infer<typeof TableBlockSchema>;
export type FlashcardsBlock = z.infer<typeof FlashcardsBlockSchema>;
export type PracticeBlock = z.infer<typeof PracticeBlockSchema>;
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>;
export type MindmapBlock = z.infer<typeof MindmapBlockSchema>;
export type MindmapNode = z.infer<typeof MindmapNodeSchema>;
export type ChartBlock = z.infer<typeof ChartBlockSchema>;
