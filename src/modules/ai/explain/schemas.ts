// /anatomy, /teardown and /infographic: request schemas, the model's frames
// and the typed results the cards render. Pure and client-safe.
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

/** The refusal message for a subject, or null. */
export function blockedTopic(subject: string): string | null {
  return BLOCKED.find(([re]) => re.test(subject))?.[1] ?? null;
}
