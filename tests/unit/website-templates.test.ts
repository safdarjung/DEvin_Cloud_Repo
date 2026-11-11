import { describe, expect, it } from "vitest";
import { BlocksSchema } from "@/modules/website/blocks";
import { WEBSITE_PAGE_KINDS, websiteTemplate } from "@/modules/website/templates";

describe("website starter templates", () => {
  it("offers the six school page kinds", () => {
    expect([...WEBSITE_PAGE_KINDS]).toEqual(["home", "about", "admissions", "academics", "facilities", "contact"]);
  });

  it.each(WEBSITE_PAGE_KINDS)("%s template parses with BlocksSchema and is not empty", (kind) => {
    const blocks = websiteTemplate(kind, "Sunrise Public School");
    expect(blocks.length).toBeGreaterThan(0);
    expect(BlocksSchema.safeParse(blocks).success).toBe(true);
  });

  it("uses the institution name in the home hero", () => {
    const [hero] = websiteTemplate("home", "Sunrise Public School");
    expect(hero).toMatchObject({ type: "hero", heading: "Welcome to Sunrise Public School" });
  });

  it.each(WEBSITE_PAGE_KINDS)("%s template stays valid for a very long or blank institution name", (kind) => {
    expect(BlocksSchema.safeParse(websiteTemplate(kind, "S".repeat(400))).success).toBe(true);
    expect(BlocksSchema.safeParse(websiteTemplate(kind, "   ")).success).toBe(true);
  });
});
