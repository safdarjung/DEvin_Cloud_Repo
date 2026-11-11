// AI website builder — request schemas and the generation frame for the two
// draft-only routes (api/ai/website-draft, api/ai/website-theme). The model
// writes a loose, every-key-present frame (no refinements, capped strings);
// toWebsiteBlocksDraft maps it onto the real block model and validates the
// whole page with BlocksSchema, so a bad draft is rejected, never partial.
// The model never writes image URLs, off-site links or contact details: those
// are copied from the page's current blocks or left for the editor to fill.
import { z } from "zod";
import { BlocksSchema, type Block } from "@/modules/website/blocks";
import { WEBSITE_PAGE_KINDS } from "@/modules/website/templates";

const institutionSlug = z.string().trim().min(1).max(100);

export const WEBSITE_TONES = ["warm", "formal", "modern", "traditional"] as const;
export const WEBSITE_BRIEF_MAX = 1000;
export const WEBSITE_DRAFT_MAX_BLOCKS = 12;

export const WebsiteDraftRequestSchema = z
  .object({
    institutionSlug,
    kind: z.enum(WEBSITE_PAGE_KINDS),
    brief: z.string().trim().min(1).max(WEBSITE_BRIEF_MAX),
    tone: z.enum(WEBSITE_TONES).optional(),
    /** The editor's working blocks, sent for a "refine this page" request. */
    currentBlocks: BlocksSchema.optional(),
  })
  .strict();

export const WebsiteThemeRequestSchema = z.object({ institutionSlug, brief: z.string().trim().min(1).max(500) }).strict();

const heading = z.string().trim().max(200);
const GenBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), heading, subheading: z.string().trim().max(500), ctaLabel: z.string().trim().max(80), ctaHref: z.string().trim().max(200) }).strict(),
  z
    .object({
      type: z.literal("rich_text"),
      heading,
      paragraphs: z.array(z.string().trim().max(1000)).max(10),
      bullets: z.array(z.string().trim().max(300)).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal("stats"),
      heading,
      items: z.array(z.object({ label: z.string().trim().max(80), value: z.string().trim().max(40) }).strict()).min(1).max(8),
    })
    .strict(),
  z.object({ type: z.literal("notice_list"), heading }).strict(),
  z.object({ type: z.literal("event_list"), heading }).strict(),
  z.object({ type: z.literal("enquiry_form"), heading, ctaLabel: z.string().trim().max(40) }).strict(),
  z.object({ type: z.literal("contact"), heading }).strict(),
]);

export const WebsiteDraftGenerationSchema = z.object({ blocks: z.array(GenBlockSchema).min(1).max(WEBSITE_DRAFT_MAX_BLOCKS) }).strict();
export type WebsiteDraftGeneration = z.infer<typeof WebsiteDraftGenerationSchema>;
type GenBlock = WebsiteDraftGeneration["blocks"][number];

const opt = (value: string): string | undefined => value.trim() || undefined;
// Only same-site paths: a model-written link to another host is dropped.
const isSitePath = (href: string): boolean => href.startsWith("/") && !href.startsWith("//");

function toBlock(gen: GenBlock, current: readonly Block[]): Block {
  switch (gen.type) {
    case "hero": {
      const imageUrl = current.find((b) => b.type === "hero")?.imageUrl;
      const cta = gen.ctaLabel && isSitePath(gen.ctaHref) ? { label: gen.ctaLabel, href: gen.ctaHref } : undefined;
      return { type: "hero", heading: gen.heading, subheading: opt(gen.subheading), imageUrl, cta };
    }
    case "rich_text": {
      const nodes: Extract<Block, { type: "rich_text" }>["nodes"] = [];
      if (gen.heading) nodes.push({ type: "heading", level: 2, text: gen.heading });
      for (const text of gen.paragraphs.filter(Boolean)) nodes.push({ type: "paragraph", spans: [{ text }] });
      const items = gen.bullets.filter(Boolean);
      if (items.length) nodes.push({ type: "list", ordered: false, items });
      return { type: "rich_text", nodes };
    }
    case "stats":
      return { type: "stats", heading: opt(gen.heading), items: gen.items };
    case "notice_list":
    case "event_list":
      return { type: gen.type, heading: opt(gen.heading) };
    case "enquiry_form":
      return { type: "enquiry_form", heading: opt(gen.heading), ctaLabel: opt(gen.ctaLabel) };
    case "contact": {
      const known = current.find((b) => b.type === "contact");
      return { type: "contact", heading: opt(gen.heading), address: known?.address, phone: known?.phone, email: known?.email, mapUrl: known?.mapUrl };
    }
  }
}

/** Model output -> editor blocks, validated whole; any invalid block rejects the draft. */
export function toWebsiteBlocksDraft(raw: unknown, current: readonly Block[] = []): { ok: true; blocks: Block[] } | { ok: false } {
  const gen = WebsiteDraftGenerationSchema.safeParse(raw);
  if (!gen.success) return { ok: false };
  const parsed = BlocksSchema.safeParse(gen.data.blocks.map((b) => toBlock(b, current)));
  return parsed.success ? { ok: true, blocks: parsed.data } : { ok: false };
}
