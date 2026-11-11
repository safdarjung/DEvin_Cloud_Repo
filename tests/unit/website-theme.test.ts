import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBSITE_THEME,
  THEME_FONTS,
  WebsiteThemeSchema,
  parseThemeSafely,
  themeContrastIssues,
  websiteThemeStyle,
} from "@/modules/website/theme";

const navyGold = {
  primary: "#1E3A8A",
  accent: "#D4A017",
  background: "#FFFDF7",
  foreground: "#1F2937",
  headingFont: "classic_serif",
  bodyFont: "system",
  radius: "small",
  heroStyle: "banner",
} as const;

describe("WebsiteThemeSchema", () => {
  it("accepts a well-formed theme and the default", () => {
    expect(WebsiteThemeSchema.safeParse(navyGold).success).toBe(true);
    expect(WebsiteThemeSchema.safeParse(DEFAULT_WEBSITE_THEME).success).toBe(true);
  });

  it.each([
    ["short hex", "#fff"],
    ["named colour", "navy"],
    ["rgb()", "rgb(0,0,0)"],
    ["url(...)", "url(https://evil.example/x.png)"],
    ["declaration break", "#000000;background:url(x)"],
    ["rule break", "#000000}body{display:none"],
    ["trailing newline", "#000000\n"],
    ["var()", "var(--x)"],
  ])("rejects a non-hex colour: %s", (_label, value) => {
    for (const key of ["primary", "accent", "background", "foreground"] as const) {
      expect(WebsiteThemeSchema.safeParse({ ...navyGold, [key]: value }).success).toBe(false);
    }
  });

  it("rejects unknown fonts, raw font stacks, unknown radius/hero values and extra keys", () => {
    expect(WebsiteThemeSchema.safeParse({ ...navyGold, headingFont: "Comic Sans MS" }).success).toBe(false);
    expect(WebsiteThemeSchema.safeParse({ ...navyGold, bodyFont: "Arial; } body { color: red" }).success).toBe(false);
    expect(WebsiteThemeSchema.safeParse({ ...navyGold, radius: "9999px" }).success).toBe(false);
    expect(WebsiteThemeSchema.safeParse({ ...navyGold, heroStyle: "video" }).success).toBe(false);
    expect(WebsiteThemeSchema.safeParse({ ...navyGold, css: "body{}" }).success).toBe(false);
  });

  it("has a fixed allow-list of 6 to 8 font stacks", () => {
    const count = Object.keys(THEME_FONTS).length;
    expect(count).toBeGreaterThanOrEqual(6);
    expect(count).toBeLessThanOrEqual(8);
  });
});

describe("parseThemeSafely", () => {
  it("returns the stored theme when it parses, else the default", () => {
    expect(parseThemeSafely(navyGold)).toEqual(navyGold);
    expect(parseThemeSafely(null)).toEqual(DEFAULT_WEBSITE_THEME);
    expect(parseThemeSafely({ ...navyGold, primary: "url(x)" })).toEqual(DEFAULT_WEBSITE_THEME);
    expect(parseThemeSafely("not an object")).toEqual(DEFAULT_WEBSITE_THEME);
  });
});

describe("websiteThemeStyle", () => {
  it("builds CSS variables only from the validated hex values and allow-listed stacks", () => {
    const style = websiteThemeStyle(navyGold);
    expect(style["--primary"]).toBe("#1E3A8A");
    expect(style["--accent"]).toBe("#D4A017");
    expect(style["--background"]).toBe("#FFFDF7");
    expect(style["--foreground"]).toBe("#1F2937");
    expect(style.fontFamily).toBe(THEME_FONTS.system.stack);
    expect(style["--site-heading-font"]).toBe(THEME_FONTS.classic_serif.stack);
    for (const value of Object.values(style)) expect(value).not.toMatch(/[;{}]|url\(/);
  });
});

describe("themeContrastIssues", () => {
  it("flags a foreground/background pair under WCAG 4.5:1", () => {
    const issues = themeContrastIssues({ ...navyGold, background: "#FFFFFF", foreground: "#999999" });
    expect(issues.some((i) => i.pair === "text")).toBe(true);
  });

  it("passes a readable pair (black on white is 21:1)", () => {
    const issues = themeContrastIssues({ ...navyGold, background: "#FFFFFF", foreground: "#000000" });
    expect(issues.filter((i) => i.pair === "text")).toEqual([]);
  });

  it("has no issues for the default theme", () => {
    expect(themeContrastIssues(DEFAULT_WEBSITE_THEME)).toEqual([]);
  });
});
