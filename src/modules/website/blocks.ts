// T-024/T-025 — the eight public-site block types (04 §6, 05 §2.8). Shared
// between the public renderer (this packet) and the website editor
// (T-025): both import `BlocksSchema`/`Block` from here so the two never
// drift. Every block is a constrained JSON shape, not raw HTML — the
// renderer never uses `dangerouslySetInnerHTML` (07 §1, packet rule).
import { z } from "zod";

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * A link is safe when it has no scheme (relative path, anchor, or a bare
 * path like `/admissions`) or when its scheme is http(s)/mailto/tel.
 * Blocks `javascript:`, `data:`, `vbscript:`, and anything else.
 *
 * shortcut: a value starting with `/` (including `//host` — a
 * protocol-relative URL) is treated as relative without re-checking the
 * scheme it would resolve to; that only ever resolves to http(s), which is
 * already allowed, so it is not a wider hole than the scheme check below.
 */
export function isSafeBlockUrl(value: string): boolean {
  if (value.length === 0 || /\s/.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("#")) return true;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) return true; // no scheme at all, e.g. a bare relative path

  return ALLOWED_URL_SCHEMES.has(schemeMatch[1]!.toLowerCase() + ":");
}

const SafeUrlSchema = z.string().min(1).max(2000).refine(isSafeBlockUrl, "unsafe URL scheme");

const CtaSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    href: SafeUrlSchema,
  })
  .strict();

const InlineSpanSchema = z
  .object({
    text: z.string().max(2000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    href: SafeUrlSchema.optional(),
  })
  .strict();

// Rich text is a constrained node list, never a raw HTML string (07 §1,
// 04 §6) — each node type maps to one renderer component.
const RichTextNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), spans: z.array(InlineSpanSchema).min(1).max(200) }).strict(),
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: z.string().trim().min(1).max(200) }).strict(),
  z
    .object({
      type: z.literal("list"),
      ordered: z.boolean(),
      items: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    })
    .strict(),
]);

const HeroBlockSchema = z
  .object({
    type: z.literal("hero"),
    heading: z.string().trim().min(1).max(200),
    subheading: z.string().trim().max(500).optional(),
    imageUrl: SafeUrlSchema.optional(),
    cta: CtaSchema.optional(),
  })
  .strict();

const RichTextBlockSchema = z
  .object({
    type: z.literal("rich_text"),
    nodes: z.array(RichTextNodeSchema).min(1).max(100),
  })
  .strict();

const ImageBlockSchema = z
  .object({
    type: z.literal("image"),
    url: SafeUrlSchema,
    alt: z.string().trim().min(1).max(300),
    caption: z.string().trim().max(300).optional(),
  })
  .strict();

const StatsBlockSchema = z
  .object({
    type: z.literal("stats"),
    heading: z.string().trim().max(200).optional(),
    items: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            value: z.string().trim().min(1).max(40),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const NoticeListBlockSchema = z
  .object({
    type: z.literal("notice_list"),
    heading: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const EventListBlockSchema = z
  .object({
    type: z.literal("event_list"),
    heading: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const EnquiryFormBlockSchema = z
  .object({
    type: z.literal("enquiry_form"),
    heading: z.string().trim().max(200).optional(),
    ctaLabel: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const ContactBlockSchema = z
  .object({
    type: z.literal("contact"),
    heading: z.string().trim().max(200).optional(),
    address: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().email().optional(),
    mapUrl: SafeUrlSchema.optional(),
  })
  .strict();

export const BlockSchema = z.discriminatedUnion("type", [
  HeroBlockSchema,
  RichTextBlockSchema,
  ImageBlockSchema,
  StatsBlockSchema,
  NoticeListBlockSchema,
  EventListBlockSchema,
  EnquiryFormBlockSchema,
  ContactBlockSchema,
]);

export const BlocksSchema = z.array(BlockSchema).max(50);

export type Block = z.infer<typeof BlockSchema>;
export type HeroBlock = z.infer<typeof HeroBlockSchema>;
export type RichTextBlock = z.infer<typeof RichTextBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type StatsBlock = z.infer<typeof StatsBlockSchema>;
export type NoticeListBlock = z.infer<typeof NoticeListBlockSchema>;
export type EventListBlock = z.infer<typeof EventListBlockSchema>;
export type EnquiryFormBlock = z.infer<typeof EnquiryFormBlockSchema>;
export type ContactBlock = z.infer<typeof ContactBlockSchema>;

const NavItemSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    path: SafeUrlSchema,
  })
  .strict();

const NavSchema = z.array(NavItemSchema).max(20);

export type NavItem = z.infer<typeof NavItemSchema>;

/** `websites.nav` is editor-authored JSON (T-025); same safety posture as blocks — an invalid or missing nav renders no nav links rather than throwing. */
export function parseNavSafely(raw: unknown): NavItem[] {
  const parsed = NavSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Parses a `page_versions.blocks` JSON array, dropping any entry that isn't
 * a valid block instead of throwing — one bad/unknown block (a future block
 * type the renderer doesn't know yet, or a draft shape mid-edit) must never
 * take down the whole page (07 §1, packet rule "skip unknown or invalid
 * blocks safely").
 */
export function parseBlocksSafely(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const blocks: Block[] = [];
  for (const entry of raw) {
    const parsed = BlockSchema.safeParse(entry);
    if (parsed.success) blocks.push(parsed.data);
  }
  return blocks;
}
