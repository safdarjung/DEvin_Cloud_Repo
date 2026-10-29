import { describe, expect, it } from "vitest";
import { BlockSchema, BlocksSchema, isSafeBlockUrl, parseBlocksSafely } from "@/modules/website/blocks";

describe("isSafeBlockUrl (07 §1 — links allow only http(s)/mailto/tel/relative)", () => {
  it("allows http and https URLs", () => {
    expect(isSafeBlockUrl("https://example.com/page")).toBe(true);
    expect(isSafeBlockUrl("http://example.com")).toBe(true);
  });

  it("allows mailto and tel", () => {
    expect(isSafeBlockUrl("mailto:admissions@example.com")).toBe(true);
    expect(isSafeBlockUrl("tel:+919800000000")).toBe(true);
  });

  it("allows relative paths and anchors", () => {
    expect(isSafeBlockUrl("/admissions")).toBe(true);
    expect(isSafeBlockUrl("#contact")).toBe(true);
    expect(isSafeBlockUrl("admissions")).toBe(true);
  });

  it("blocks javascript: and other dangerous schemes", () => {
    expect(isSafeBlockUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeBlockUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeBlockUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeBlockUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("blocks empty or whitespace-containing values", () => {
    expect(isSafeBlockUrl("")).toBe(false);
    expect(isSafeBlockUrl("java\tscript:alert(1)")).toBe(false);
  });
});

describe("BlockSchema — eight block types", () => {
  it("accepts a valid hero block with a cta", () => {
    const result = BlockSchema.safeParse({
      type: "hero",
      heading: "Welcome",
      subheading: "A school for everyone",
      cta: { label: "Apply now", href: "/admissions" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a hero block whose cta href is a javascript: URL", () => {
    const result = BlockSchema.safeParse({
      type: "hero",
      heading: "Welcome",
      cta: { label: "Click", href: "javascript:alert(1)" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a rich_text block with paragraph, heading and list nodes", () => {
    const result = BlockSchema.safeParse({
      type: "rich_text",
      nodes: [
        { type: "heading", level: 2, text: "About us" },
        { type: "paragraph", spans: [{ text: "We are a school.", bold: true }] },
        { type: "list", ordered: false, items: ["CBSE affiliated", "Founded 1990"] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a rich_text span with an unsafe href", () => {
    const result = BlockSchema.safeParse({
      type: "rich_text",
      nodes: [{ type: "paragraph", spans: [{ text: "click", href: "javascript:alert(1)" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts image, stats, notice_list, event_list, enquiry_form and contact blocks", () => {
    expect(BlockSchema.safeParse({ type: "image", url: "/photo.jpg", alt: "Campus" }).success).toBe(true);
    expect(
      BlockSchema.safeParse({ type: "stats", items: [{ label: "Students", value: "3,024" }] }).success,
    ).toBe(true);
    expect(BlockSchema.safeParse({ type: "notice_list", limit: 5 }).success).toBe(true);
    expect(BlockSchema.safeParse({ type: "event_list", heading: "Upcoming" }).success).toBe(true);
    expect(BlockSchema.safeParse({ type: "enquiry_form", ctaLabel: "Enquire" }).success).toBe(true);
    expect(
      BlockSchema.safeParse({ type: "contact", phone: "9800000000", email: "a@b.com" }).success,
    ).toBe(true);
  });

  it("rejects an unknown block type", () => {
    expect(BlockSchema.safeParse({ type: "video", url: "/x.mp4" }).success).toBe(false);
  });

  it("rejects unknown extra keys (.strict())", () => {
    expect(BlockSchema.safeParse({ type: "hero", heading: "H", extra: "nope" }).success).toBe(false);
  });
});

describe("parseBlocksSafely — skips unknown/invalid blocks instead of throwing", () => {
  it("keeps valid blocks and drops invalid ones", () => {
    const result = parseBlocksSafely([
      { type: "hero", heading: "Welcome" },
      { type: "video", url: "/x.mp4" }, // unknown type
      { type: "image", url: "/a.jpg" }, // missing required `alt`
      { type: "contact", phone: "9800000000" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "hero" });
    expect(result[1]).toMatchObject({ type: "contact" });
  });

  it("returns an empty array for non-array input", () => {
    expect(parseBlocksSafely(null)).toEqual([]);
    expect(parseBlocksSafely({ type: "hero" })).toEqual([]);
    expect(parseBlocksSafely(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty page", () => {
    expect(parseBlocksSafely([])).toEqual([]);
  });
});

describe("BlocksSchema — array of up to 50 blocks", () => {
  it("accepts an array of valid blocks", () => {
    const result = BlocksSchema.safeParse([
      { type: "hero", heading: "Welcome" },
      { type: "rich_text", nodes: [{ type: "paragraph", spans: [{ text: "hi" }] }] },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects more than 50 blocks", () => {
    const blocks = Array.from({ length: 51 }, () => ({ type: "hero" as const, heading: "H" }));
    expect(BlocksSchema.safeParse(blocks).success).toBe(false);
  });
});
