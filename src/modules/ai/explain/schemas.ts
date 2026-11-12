// /anatomy, /teardown, /infographic, /mindmap, /diagram and /image: request schemas, the
// model's frames and the typed results the cards render. Pure and client-safe.
// The model fills a flat, every-key-present frame with no array bounds (Gemini
// refuses nested maxItems); toAnatomy / toInfographic clip, cap and drop what
// does not fit, then the strict output schema checks the whole result.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const EXPLAIN_MODES = ["anatomy", "teardown"] as const;
export const EXPLAIN_DEPTHS = ["simple", "standard", "deep"] as const;
export const EXPLAIN_LANGUAGES = ["en", "hi"] as const;
export const INFOGRAPHIC_AUDIENCES = ["student", "teacher", "parent", "staff"] as const;
export const INFOGRAPHIC_PALETTES = ["ocean", "forest", "sunrise", "berry", "ink"] as const;
export const BLOCK_TYPES = ["stat", "steps", "compare", "timeline", "parts", "callout", "chart"] as const;

export type ExplainMode = (typeof EXPLAIN_MODES)[number];
export type ExplainDepth = (typeof EXPLAIN_DEPTHS)[number];
export type ExplainLanguage = (typeof EXPLAIN_LANGUAGES)[number];
export type InfographicPalette = (typeof INFOGRAPHIC_PALETTES)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
const institutionSlug = z.string().trim().min(1).max(100);

// ---- typed results (what the cards render) ----

export const AnatomySchema = z
  .object({
    title: line(100),
    summary: line(900),
    parts: z
      .array(z.object({ name: line(60), role: line(240), madeOf: line(160).optional(), connectsTo: z.array(line(60)).max(4) }).strict())
      .min(2)
      .max(10),
    howItWorks: z.array(line(300)).min(2).max(8),
    failurePoints: z.array(z.object({ what: line(120), why: line(260), sign: line(220) }).strict()).max(5),
    tryThis: z.array(line(260)).max(4),
    misconceptions: z.array(line(260)).max(4),
    gradeLevelNote: z.string().trim().max(260),
  })
  .strict();
export type Anatomy = z.infer<typeof AnatomySchema>;
export type AnatomyPart = Anatomy["parts"][number];

const heading = z.string().trim().max(80);
export const InfographicBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stat"), value: line(24), label: line(140) }).strict(),
  z.object({ type: z.literal("steps"), heading, items: z.array(line(160)).min(2).max(6) }).strict(),
  z
    .object({
      type: z.literal("compare"),
      heading,
      left: line(40),
      right: line(40),
      rows: z.array(z.object({ aspect: line(60), left: line(120), right: line(120) }).strict()).min(1).max(6),
    })
    .strict(),
  z.object({ type: z.literal("timeline"), heading, events: z.array(z.object({ when: line(40), what: line(160) }).strict()).min(2).max(7) }).strict(),
  z.object({ type: z.literal("parts"), heading, items: z.array(z.object({ name: line(60), role: line(140) }).strict()).min(2).max(8) }).strict(),
  z.object({ type: z.literal("callout"), text: line(280) }).strict(),
  z
    .object({
      type: z.literal("chart"),
      heading,
      kind: z.enum(["bar", "pie"]),
      series: z.array(z.object({ label: line(40), value: z.number().finite().nonnegative() }).strict()).min(2).max(8),
    })
    .strict(),
]);
export type InfographicBlock = z.infer<typeof InfographicBlockSchema>;

export const InfographicSchema = z
  .object({
    title: line(90),
    subtitle: z.string().trim().max(200),
    palette: z.enum(INFOGRAPHIC_PALETTES),
    blocks: z.array(InfographicBlockSchema).min(3).max(7),
    sources_note: line(300),
  })
  .strict();
export type Infographic = z.infer<typeof InfographicSchema>;

export interface AiMeta {
  provider: "local" | "cloud";
  model: string;
}
export type Refused = { refused: true; reason: string };
export type AnatomyResponse = Refused | ({ refused: false; mode: ExplainMode; depth: ExplainDepth; language: ExplainLanguage; anatomy: Anatomy } & AiMeta);
export type InfographicResponse = Refused | ({ refused: false; infographic: Infographic } & AiMeta);

// ---- requests ----

export const AnatomyRequestSchema = z
  .object({
    institutionSlug,
    subject: z.string().trim().max(200),
    mode: z.enum(EXPLAIN_MODES),
    depth: z.enum(EXPLAIN_DEPTHS),
    language: z.enum(EXPLAIN_LANGUAGES).default("en"),
    /** A file on the caller's study shelf (curriculum_materials.id): a photo or PDF the AI reads. */
    documentId: uuid.optional(),
  })
  .strict()
  .refine((r) => r.subject.length > 0 || r.documentId !== undefined, { message: "Say what to explain, or attach a photo.", path: ["subject"] });
export type AnatomyRequest = z.infer<typeof AnatomyRequestSchema>;

export const InfographicRequestSchema = z
  .object({
    institutionSlug,
    topic: z.string().trim().min(1).max(200),
    audience: z.enum(INFOGRAPHIC_AUDIENCES),
    language: z.enum(EXPLAIN_LANGUAGES).default("en"),
    fromAnatomy: AnatomySchema.optional(),
  })
  .strict();
export type InfographicRequest = z.infer<typeof InfographicRequestSchema>;

// ---- model frames ----

export const AnatomyGenerationSchema = z
  .object({
    refusal: z.string(),
    title: z.string(),
    summary: z.string(),
    parts: z.array(z.object({ name: z.string(), role: z.string(), madeOf: z.string(), connectsTo: z.array(z.string()) }).strict()),
    howItWorks: z.array(z.string()),
    failurePoints: z.array(z.object({ what: z.string(), why: z.string(), sign: z.string() }).strict()),
    tryThis: z.array(z.string()),
    misconceptions: z.array(z.string()),
    gradeLevelNote: z.string(),
  })
  .strict();
export type AnatomyGeneration = z.infer<typeof AnatomyGenerationSchema>;

export const InfographicGenerationSchema = z
  .object({
    refusal: z.string(),
    title: z.string(),
    subtitle: z.string(),
    palette: z.enum(INFOGRAPHIC_PALETTES),
    blocks: z.array(
      z
        .object({
          type: z.enum(BLOCK_TYPES),
          heading: z.string(),
          value: z.string(),
          label: z.string(),
          items: z.array(z.string()),
          parts: z.array(z.object({ name: z.string(), role: z.string() }).strict()),
          events: z.array(z.object({ when: z.string(), what: z.string() }).strict()),
          left: z.string(),
          right: z.string(),
          rows: z.array(z.object({ aspect: z.string(), left: z.string(), right: z.string() }).strict()),
          text: z.string(),
          chartKind: z.enum(["bar", "pie"]),
          series: z.array(z.object({ label: z.string(), value: z.number() }).strict()),
        })
        .strict(),
    ),
  })
  .strict();
export type InfographicGeneration = z.infer<typeof InfographicGenerationSchema>;

// ---- mapping ----

export function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
const texts = (xs: string[], max: number, cap: number) => xs.map((x) => clip(x, max)).filter(Boolean).slice(0, cap);

export function toAnatomy(g: AnatomyGeneration): Anatomy | null {
  const seen = new Set<string>();
  const parts = g.parts
    .map((p) => ({ ...p, name: clip(p.name, 60), role: clip(p.role, 240) }))
    .filter((p) => p.name && p.role && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
    .slice(0, 10);
  const canonical = new Map(parts.map((p) => [p.name.toLowerCase(), p.name]));
  const anatomy: Anatomy = {
    title: clip(g.title, 100),
    summary: clip(g.summary, 900),
    parts: parts.map((p) => {
      const links = p.connectsTo.map((c) => canonical.get(clip(c, 60).toLowerCase())).filter((c): c is string => c !== undefined && c !== p.name);
      const madeOf = clip(p.madeOf, 160);
      return { name: p.name, role: p.role, ...(madeOf ? { madeOf } : {}), connectsTo: [...new Set(links)].slice(0, 4) };
    }),
    howItWorks: texts(g.howItWorks, 300, 8),
    failurePoints: g.failurePoints
      .map((f) => ({ what: clip(f.what, 120), why: clip(f.why, 260), sign: clip(f.sign, 220) }))
      .filter((f) => f.what && f.why && f.sign)
      .slice(0, 5),
    tryThis: texts(g.tryThis, 260, 4),
    misconceptions: texts(g.misconceptions, 260, 4),
    gradeLevelNote: clip(g.gradeLevelNote, 260),
  };
  return AnatomySchema.safeParse(anatomy).success ? anatomy : null;
}

type GenBlock = InfographicGeneration["blocks"][number];

function toBlock(b: GenBlock): InfographicBlock | null {
  const h = clip(b.heading, 80);
  const candidate = ((): InfographicBlock => {
    switch (b.type) {
      case "stat":
        return { type: "stat", value: clip(b.value, 24), label: clip(b.label, 140) };
      case "steps":
        return { type: "steps", heading: h, items: texts(b.items, 160, 6) };
      case "compare":
        return {
          type: "compare",
          heading: h,
          left: clip(b.left, 40),
          right: clip(b.right, 40),
          rows: b.rows.map((r) => ({ aspect: clip(r.aspect, 60), left: clip(r.left, 120), right: clip(r.right, 120) })).filter((r) => r.aspect && r.left && r.right).slice(0, 6),
        };
      case "timeline":
        return { type: "timeline", heading: h, events: b.events.map((e) => ({ when: clip(e.when, 40), what: clip(e.what, 160) })).filter((e) => e.when && e.what).slice(0, 7) };
      case "parts":
        return { type: "parts", heading: h, items: b.parts.map((p) => ({ name: clip(p.name, 60), role: clip(p.role, 140) })).filter((p) => p.name && p.role).slice(0, 8) };
      case "callout":
        return { type: "callout", text: clip(b.text, 280) };
      case "chart": {
        const series = b.series.map((s) => ({ label: clip(s.label, 40), value: s.value })).filter((s) => s.label && Number.isFinite(s.value) && s.value >= 0).slice(0, 8);
        return { type: "chart", heading: h, kind: b.chartKind, series };
      }
    }
  })();
  if (candidate.type === "chart" && candidate.series.every((s) => s.value === 0)) return null;
  return InfographicBlockSchema.safeParse(candidate).success ? candidate : null;
}

export const SOURCES_NOTE = "AI-generated from general knowledge. Check facts and numbers before you share or print it.";

export function toInfographic(g: InfographicGeneration): Infographic | null {
  const infographic: Infographic = {
    title: clip(g.title, 90),
    subtitle: clip(g.subtitle, 200),
    palette: g.palette,
    blocks: g.blocks.map(toBlock).filter((b): b is InfographicBlock => b !== null).slice(0, 7),
    sources_note: SOURCES_NOTE,
  };
  return InfographicSchema.safeParse(infographic).success ? infographic : null;
}

// ---- mind map and flow diagram (/mindmap, /diagram) ----

export const MindMapSchema = z
  .object({
    title: line(80),
    branches: z
      .array(
        z
          .object({
            label: line(60),
            twigs: z.array(z.object({ label: line(90), leaves: z.array(line(60)).max(3) }).strict()).max(5),
          })
          .strict(),
      )
      .min(3)
      .max(8),
  })
  .strict();
export type MindMap = z.infer<typeof MindMapSchema>;

export const FLOW_KINDS = ["start", "step", "decision", "end"] as const;
export const FlowSchema = z
  .object({
    title: line(90),
    nodes: z.array(z.object({ id: line(16), label: line(110), kind: z.enum(FLOW_KINDS) }).strict()).min(3).max(14),
    edges: z.array(z.object({ from: line(16), to: line(16), label: z.string().trim().max(28) }).strict()).min(2).max(28),
  })
  .strict();
export type Flow = z.infer<typeof FlowSchema>;

export type MindMapResponse = Refused | ({ refused: false; mindmap: MindMap } & AiMeta);
export type DiagramResponse = Refused | ({ refused: false; flow: Flow } & AiMeta);

/** One request shape for both: only the topic the person typed reaches the model. */
export const VisualRequestSchema = z
  .object({
    institutionSlug,
    topic: z.string().trim().min(1).max(200),
    language: z.enum(EXPLAIN_LANGUAGES).default("en"),
    /** A file on the caller's study shelf: draw the map or flowchart from the file instead of from the topic alone. */
    materialId: uuid.optional(),
  })
  .strict();
export type VisualRequest = z.infer<typeof VisualRequestSchema>;

export const MindMapGenerationSchema = z
  .object({
    refusal: z.string(),
    title: z.string(),
    branches: z.array(z.object({ label: z.string(), twigs: z.array(z.object({ label: z.string(), leaves: z.array(z.string()) }).strict()) }).strict()),
  })
  .strict();
export type MindMapGeneration = z.infer<typeof MindMapGenerationSchema>;

export const FlowGenerationSchema = z
  .object({
    refusal: z.string(),
    title: z.string(),
    steps: z.array(
      z.object({ id: z.string(), label: z.string(), kind: z.enum(FLOW_KINDS), next: z.array(z.object({ to: z.string(), label: z.string() }).strict()) }).strict(),
    ),
  })
  .strict();
export type FlowGeneration = z.infer<typeof FlowGenerationSchema>;

export function toMindMap(g: MindMapGeneration): MindMap | null {
  const seen = new Set<string>();
  const mindmap: MindMap = {
    title: clip(g.title, 80),
    branches: g.branches
      .map((b) => ({
        label: clip(b.label, 60),
        twigs: b.twigs.map((t) => ({ label: clip(t.label, 90), leaves: texts(t.leaves, 60, 3) })).filter((t) => t.label).slice(0, 5),
      }))
      .filter((b) => b.label && !seen.has(b.label.toLowerCase()) && seen.add(b.label.toLowerCase()))
      .slice(0, 8),
  };
  return MindMapSchema.safeParse(mindmap).success ? mindmap : null;
}

/** Ids are the model's own: steps with a blank or repeated id are dropped, and so is every arrow to a step that is not there. */
export function toFlow(g: FlowGeneration): Flow | null {
  const id = (raw: string) => clip(raw, 16).toLowerCase();
  const seen = new Set<string>();
  const steps = g.steps
    .map((s) => ({ ...s, id: id(s.id), label: clip(s.label, 110) }))
    .filter((s) => s.id && s.label && !seen.has(s.id) && seen.add(s.id))
    .slice(0, 14);
  const known = new Set(steps.map((s) => s.id));
  const drawn = new Set<string>();
  const edges = steps
    .flatMap((s) => s.next.map((n) => ({ from: s.id, to: id(n.to), label: clip(n.label, 28) })))
    .filter((e) => known.has(e.to) && e.to !== e.from && !drawn.has(`${e.from}>${e.to}`) && drawn.add(`${e.from}>${e.to}`))
    .slice(0, 28);
  // A step no arrow touches is not part of the process.
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const flow: Flow = { title: clip(g.title, 90), nodes: steps.filter((s) => touched.has(s.id)).map((s) => ({ id: s.id, label: s.label, kind: s.kind })), edges };
  return FlowSchema.safeParse(flow).success ? flow : null;
}

// ---- safety pre-check (anatomy/teardown explain how things work: refuse these before any model call) ----

const BLOCKED: [RegExp, string][] = [
  [
    /\b(guns?|pistols?|rifles?|revolvers?|firearms?|bombs?|explosives?|grenades?|ammunition|ammo|silencers?|landmines?|molotov)\b/i,
    "I can't take apart weapons or explosives here. Try a machine, an organism or a process instead.",
  ],
  [/\b(cocaine|heroin|meth|methamphetamine|mdma|lsd|fentanyl|ganja|charas|marijuana|cannabis)\b/i, "I can't explain drugs here. Ask a teacher or counsellor if you have questions about them."],
  [
    /\b(self[- ]?harm|suicide|kill (myself|yourself)|overdose)\b/i,
    "I can't help with that here. If you are thinking about hurting yourself, please talk to a teacher, counsellor or someone you trust today, or call Tele-MANAS on 14416.",
  ],
  [
    /\b(pick(ing)?|bypass(ing)?|break(ing)? into|crack(ing)?|hack(ing)?|disabl(e|ing))\b.{0,30}\b(locks?|padlocks?|passwords?|security|alarms?|wi-?fi|cctv|cameras?)\b/i,
    "I can't explain how to get past locks, passwords or security. I can explain how a lock works instead.",
  ],
];

/** A picture is refused for these too (the model's own filters are the second line, not the first). */
const PICTURE_BLOCKED: [RegExp, string][] = [
  [/\b(nude|nudity|naked|sexy|sexual|porn\w*|erotic|lingerie|topless|undress\w*)\b/i, "I can't draw that. Ask for a picture that helps with a lesson instead."],
  [/\b(gore|gory|corpses?|dead bod(y|ies)|behead\w*|mutilat\w*|tortur\w*|massacre)\b/i, "I can't draw violent or gory pictures. Ask for a diagram or a scene from a lesson instead."],
];

/** The refusal message for a picture request, or null. */
export function blockedPicture(prompt: string): string | null {
  return blockedTopic(prompt) ?? PICTURE_BLOCKED.find(([re]) => re.test(prompt))?.[1] ?? null;
}

export const ImageRequestSchema = z.object({ institutionSlug, prompt: z.string().trim().min(3).max(400) }).strict();
export type ImageRequest = z.infer<typeof ImageRequestSchema>;
/** The picture travels as base64 in the answer: nothing is stored on the server. */
export type ImageResponse = Refused | ({ refused: false; prompt: string; image: { base64: string; mediaType: string } } & AiMeta);

/** The refusal message for a subject, or null. */
export function blockedTopic(subject: string): string | null {
  return BLOCKED.find(([re]) => re.test(subject))?.[1] ?? null;
}

// ---- ask a file ----

export const FILE_ACTIONS = ["ask", "summary"] as const;
export const FileAskRequestSchema = z
  .object({
    institutionSlug,
    /** A file on the caller's study shelf (curriculum_materials.id), uploaded from the orb or the Study page. */
    materialId: uuid,
    action: z.enum(FILE_ACTIONS),
    question: z.string().trim().max(500).default(""),
    language: z.enum(EXPLAIN_LANGUAGES).default("en"),
  })
  .strict()
  .refine((r) => r.action === "summary" || r.question.length > 0, { message: "Type a question about the file.", path: ["question"] });
export type FileAskRequest = z.infer<typeof FileAskRequestSchema>;

export const FileAnswerGenerationSchema = z
  .object({ refusal: z.string(), answer: z.string(), points: z.array(z.string()), found: z.boolean(), followUps: z.array(z.string()) })
  .strict();
export type FileAnswerGeneration = z.infer<typeof FileAnswerGenerationSchema>;

export const FileAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(2400),
    points: z.array(line(240)).max(6),
    /** false: the file does not cover the question (the answer says so). */
    found: z.boolean(),
    followUps: z.array(line(120)).max(3),
  })
  .strict();
export type FileAnswer = z.infer<typeof FileAnswerSchema>;
export type FileAnswerResponse = Refused | ({ refused: false; fileName: string; action: (typeof FILE_ACTIONS)[number]; result: FileAnswer } & AiMeta);

export function toFileAnswer(g: FileAnswerGeneration): FileAnswer | null {
  const clean = (xs: string[], max: number, n: number) => [...new Set(xs.map((x) => clip(x, max)).filter(Boolean))].slice(0, n);
  const parsed = FileAnswerSchema.safeParse({ answer: clip(g.answer, 2400), points: clean(g.points, 240, 6), found: g.found, followUps: clean(g.followUps, 120, 3) });
  return parsed.success ? parsed.data : null;
}

// ---- flashcards ----

export const FlashcardsSchema = z
  .object({ title: line(80), cards: z.array(z.object({ front: line(160), back: line(300) }).strict()).min(4).max(16) })
  .strict();
export type Flashcards = z.infer<typeof FlashcardsSchema>;
export type FlashcardsResponse = Refused | ({ refused: false; flashcards: Flashcards } & AiMeta);

export const FlashcardsGenerationSchema = z
  .object({ refusal: z.string(), title: z.string(), cards: z.array(z.object({ front: z.string(), back: z.string() }).strict()) })
  .strict();
export type FlashcardsGeneration = z.infer<typeof FlashcardsGenerationSchema>;

export function toFlashcards(g: FlashcardsGeneration): Flashcards | null {
  const seen = new Set<string>();
  const cards = g.cards
    .map((c) => ({ front: clip(c.front, 160), back: clip(c.back, 300) }))
    .filter((c) => c.front && c.back && !seen.has(c.front.toLowerCase()) && seen.add(c.front.toLowerCase()))
    .slice(0, 16);
  const parsed = FlashcardsSchema.safeParse({ title: clip(g.title, 80), cards });
  return parsed.success ? parsed.data : null;
}

// ---- lesson plan (teachers) ----

/** The teacher's own words, e.g. "class 10, acids bases and salts, 40 minutes, tomorrow". */
export const LessonPlanRequestSchema = z
  .object({ institutionSlug, request: z.string().trim().min(3).max(300), language: z.enum(EXPLAIN_LANGUAGES).default("en") })
  .strict();
export type LessonPlanRequest = z.infer<typeof LessonPlanRequestSchema>;

export const LESSON_MINUTES = { min: 15, max: 120, fallback: 40 } as const;

export const LessonPlanGenerationSchema = z
  .object({
    refusal: z.string(),
    title: z.string(),
    classLabel: z.string(),
    subject: z.string(),
    minutes: z.number(),
    objectives: z.array(z.string()),
    materials: z.array(z.string()),
    phases: z.array(z.object({ name: z.string(), minutes: z.number(), teacher: z.string(), students: z.string() }).strict()),
    boardNotes: z.array(z.string()),
    checks: z.array(z.object({ question: z.string(), answer: z.string() }).strict()),
    support: z.string(),
    stretch: z.string(),
    misconceptions: z.array(z.string()),
    homework: z.string(),
  })
  .strict();
export type LessonPlanGeneration = z.infer<typeof LessonPlanGenerationSchema>;

const optText = (max: number) => z.string().trim().max(max);
export const LessonPlanDocSchema = z
  .object({
    title: line(120),
    classLabel: optText(60),
    subject: optText(60),
    minutes: z.number().int().min(LESSON_MINUTES.min).max(LESSON_MINUTES.max),
    objectives: z.array(line(220)).min(2).max(5),
    materials: z.array(line(120)).max(8),
    phases: z.array(z.object({ name: line(60), minutes: z.number().int().min(1).max(LESSON_MINUTES.max), teacher: line(500), students: optText(300) }).strict()).min(3).max(7),
    boardNotes: z.array(line(200)).max(8),
    checks: z.array(z.object({ question: line(240), answer: line(300) }).strict()).min(2).max(5),
    support: optText(300),
    stretch: optText(300),
    misconceptions: z.array(line(260)).max(4),
    homework: optText(300),
  })
  .strict();
export type LessonPlanDoc = z.infer<typeof LessonPlanDocSchema>;
export type LessonPlanResponse = Refused | ({ refused: false; plan: LessonPlanDoc } & AiMeta);

/** Phase minutes rescaled to add up exactly to the lesson's length (the model's sums drift). */
export function fitMinutes(weights: readonly number[], total: number): number[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.max(1, Math.round((x / sum) * total)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  // Put the rounding difference on the longest phases, never below one minute.
  const order = out.map((m, i) => [m, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; diff !== 0 && k < 1000; k++) {
    const i = order[k % order.length]!;
    if (diff > 0) {
      out[i]! += 1;
      diff--;
    } else if (out[i]! > 1) {
      out[i]! -= 1;
      diff++;
    }
  }
  return out;
}

export function toLessonPlanDoc(g: LessonPlanGeneration): LessonPlanDoc | null {
  const list = (xs: string[], max: number, n: number) => [...new Set(xs.map((x) => clip(x, max)).filter(Boolean))].slice(0, n);
  const minutes = Math.min(LESSON_MINUTES.max, Math.max(LESSON_MINUTES.min, Math.round(g.minutes) || LESSON_MINUTES.fallback));
  const phases = g.phases
    .map((p) => ({ name: clip(p.name, 60), minutes: p.minutes, teacher: clip(p.teacher, 500), students: clip(p.students, 300) }))
    .filter((p) => p.name && p.teacher)
    .slice(0, 7);
  const fitted = fitMinutes(phases.map((p) => p.minutes), minutes);
  const parsed = LessonPlanDocSchema.safeParse({
    title: clip(g.title, 120),
    classLabel: clip(g.classLabel, 60),
    subject: clip(g.subject, 60),
    minutes,
    objectives: list(g.objectives, 220, 5),
    materials: list(g.materials, 120, 8),
    phases: phases.map((p, i) => ({ ...p, minutes: fitted[i]! })),
    boardNotes: list(g.boardNotes, 200, 8),
    checks: g.checks.map((c) => ({ question: clip(c.question, 240), answer: clip(c.answer, 300) })).filter((c) => c.question && c.answer).slice(0, 5),
    support: clip(g.support, 300),
    stretch: clip(g.stretch, 300),
    misconceptions: list(g.misconceptions, 260, 4),
    homework: clip(g.homework, 300),
  });
  return parsed.success ? parsed.data : null;
}

/** The plan as the lesson-plan form's text fields (objectives and resources, 2000 characters each). */
export function lessonPlanFormText(plan: LessonPlanDoc, chosen: readonly { title: string; url: string }[] = []): { title: string; objectives: string; resources: string } {
  const cap = (t: string) => (t.length > 2000 ? `${t.slice(0, 1997)}...` : t);
  return {
    title: plan.title.slice(0, 120),
    objectives: cap(plan.objectives.map((o) => `- ${o}`).join("\n")),
    resources: cap(
      [
        ...plan.phases.map((p) => `${p.name} (${p.minutes} min): ${p.teacher}`),
        plan.materials.length ? `Materials: ${plan.materials.join(", ")}` : "",
        plan.checks.length ? `Check: ${plan.checks.map((c) => c.question).join(" ")}` : "",
        plan.homework ? `Homework: ${plan.homework}` : "",
        ...chosen.map((r) => `Resource: ${r.title} (${r.url})`),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  };
}

// ---- teaching resources for a lesson ----

export const RESOURCE_SOURCES = ["school", "web"] as const;
export const LessonResourcesRequestSchema = z
  .object({ institutionSlug, topic: z.string().trim().min(2).max(200), classLabel: z.string().trim().max(60).default(""), source: z.enum(RESOURCE_SOURCES) })
  .strict();
export type LessonResourcesRequest = z.infer<typeof LessonResourcesRequestSchema>;

export interface LessonResource {
  title: string;
  /** https link, or an in-app path for the school's own files. */
  url: string;
  kind: "video" | "simulation" | "reading" | "worksheet" | "link" | "file" | "note";
  why: string;
  source: "school" | "web";
}
export type LessonResourcesResponse = { resources: LessonResource[]; note: string };

const KINDS = new Set(["video", "simulation", "reading", "worksheet", "link"]);

/**
 * The model's list ("TITLE | URL | KIND | WHY" per line) kept only where the link's site is one Google
 * returned for this search: a model can invent a URL, a grounded source cannot. Pure.
 */
export function groundedResources(text: string, sources: readonly { url: string; title: string }[], max = 8): LessonResource[] {
  const hosts = new Set(
    sources.flatMap((s) => {
      const out: string[] = [];
      try {
        out.push(new URL(s.url).hostname.replace(/^www\./, ""));
      } catch {
        /* not a URL */
      }
      // Grounding links are Google redirects; their title is the real site's domain.
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.title)) out.push(s.title.toLowerCase().replace(/^www\./, ""));
      return out;
    }),
  );
  const seen = new Set<string>();
  const out: LessonResource[] = [];
  for (const line of text.split("\n")) {
    const parts = line.replace(/^[\s*•\-\d.)]+/, "").split("|").map((p) => p.trim());
    if (parts.length < 4) continue;
    const [title, url, kind, why] = parts as [string, string, string, string];
    let host = "";
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") continue;
      host = u.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const grounded = [...hosts].some((h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`));
    if (!grounded || seen.has(url) || !title) continue;
    seen.add(url);
    out.push({ title: clip(title, 120), url: url.slice(0, 500), kind: (KINDS.has(kind.toLowerCase()) ? kind.toLowerCase() : "link") as LessonResource["kind"], why: clip(why, 200), source: "web" });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * When live web search is unavailable (no key, quota used up): search links for the topic on trusted
 * education sites, built here, not by a model, so every link works. Pure.
 */
export function trustedSearchLinks(topic: string, classLabel: string): LessonResource[] {
  const q = encodeURIComponent(topic.trim());
  const qc = encodeURIComponent(`${topic.trim()} ${classLabel}`.trim());
  return [
    { title: `NCERT textbooks (find "${topic}")`, url: "https://ncert.nic.in/textbook.php", kind: "reading", why: "The official NCERT chapter for this topic, free to read.", source: "web" },
    { title: `DIKSHA: ${topic}`, url: `https://diksha.gov.in/explore?searchQuery=${q}`, kind: "reading", why: "Government e-content, videos and worksheets mapped to the CBSE syllabus.", source: "web" },
    { title: `PhET simulations: ${topic}`, url: `https://phet.colorado.edu/en/simulations/browse?q=${q}`, kind: "simulation", why: "Free interactive simulations for science and maths topics.", source: "web" },
    { title: `Khan Academy: ${topic}`, url: `https://www.khanacademy.org/search?page_search_query=${q}`, kind: "video", why: "Short explainer videos and practice questions.", source: "web" },
    { title: `YouTube: ${topic} ${classLabel}`.trim(), url: `https://www.youtube.com/results?search_query=${qc}`, kind: "video", why: "Class videos; pick one from a trusted education channel.", source: "web" },
  ];
}
