// The public site's look (`websites.theme`): four #rrggbb colours plus
// allow-listed keys for fonts, corner radius and hero style. No free-form CSS
// ever: colours pass HEX_COLOUR, every other value is an enum key mapped to a
// constant here, and the result reaches the page only as a React style object
// of CSS custom properties. Re-validated on every read (parseThemeSafely).
import { z } from "zod";
import { contrastRatio, HEX_COLOUR, MIN_CONTRAST, readableOn } from "@/modules/core/setup/branding-utils";

// System / already-bundled stacks only: no third-party font fetch on the public site.
export const THEME_FONTS = {
  jakarta: { label: "Plus Jakarta (default)", stack: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" },
  system: { label: "System sans", stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  humanist: { label: "Humanist sans", stack: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif' },
  geometric: { label: "Geometric sans", stack: 'Avenir, Montserrat, Corbel, "URW Gothic", sans-serif' },
  rounded: { label: "Rounded sans", stack: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, "Arial Rounded MT", Calibri, sans-serif' },
  classic_serif: { label: "Classic serif", stack: 'Georgia, Cambria, "Times New Roman", Times, serif' },
  old_style: { label: "Old-style serif", stack: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif' },
  slab: { label: "Slab serif", stack: 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", serif' },
} as const;
export type ThemeFont = keyof typeof THEME_FONTS;
const FONT_KEYS = Object.keys(THEME_FONTS) as [ThemeFont, ...ThemeFont[]];

export const THEME_RADII = { none: "0rem", small: "0.25rem", medium: "0.5rem", large: "0.875rem" } as const;
export type ThemeRadius = keyof typeof THEME_RADII;
const RADIUS_KEYS = Object.keys(THEME_RADII) as [ThemeRadius, ...ThemeRadius[]];

export const HERO_STYLES = ["split", "centered", "banner"] as const;
export type HeroStyle = (typeof HERO_STYLES)[number];

const hex = z.string().regex(HEX_COLOUR, "Use a #rrggbb colour.");

export const WebsiteThemeSchema = z
  .object({
    primary: hex,
    accent: hex,
    background: hex,
    foreground: hex,
    headingFont: z.enum(FONT_KEYS),
    bodyFont: z.enum(FONT_KEYS),
    radius: z.enum(RADIUS_KEYS),
    heroStyle: z.enum(HERO_STYLES),
  })
  .strict();

export type WebsiteTheme = z.infer<typeof WebsiteThemeSchema>;

/** Matches the app's own tokens (globals.css), so an unthemed site looks as it always did, plus an accent. */
export const DEFAULT_WEBSITE_THEME: WebsiteTheme = {
  primary: "#0A0A0A",
  accent: "#1D4ED8",
  background: "#FAFAFA",
  foreground: "#0A0A0A",
  headingFont: "jakarta",
  bodyFont: "jakarta",
  radius: "small",
  heroStyle: "split",
};

/** `websites.theme` is untrusted JSON on read: anything that does not parse renders the default look. */
export function parseThemeSafely(raw: unknown): WebsiteTheme {
  const parsed = WebsiteThemeSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_WEBSITE_THEME;
}

const mix = (fg: string, pct: number, bg: string) => `color-mix(in srgb, ${fg} ${pct}%, ${bg})`;

export type WebsiteThemeStyle = Record<`--${string}`, string> & { fontFamily: string };

/**
 * CSS custom properties for a themed wrapper. Takes a parsed `WebsiteTheme`
 * only: every string is a validated hex, a constant from the maps above, or a
 * color-mix() of two validated hexes.
 */
export function websiteThemeStyle(theme: WebsiteTheme): WebsiteThemeStyle {
  const { primary, accent, background: bg, foreground: fg } = theme;
  return {
    "--background": bg,
    "--foreground": fg,
    "--card": mix(fg, 4, bg),
    "--card-foreground": fg,
    "--popover": bg,
    "--popover-foreground": fg,
    "--muted": mix(fg, 7, bg),
    "--muted-foreground": mix(fg, 78, bg),
    "--secondary": mix(fg, 7, bg),
    "--secondary-foreground": fg,
    "--border": mix(fg, 14, bg),
    "--input": mix(fg, 22, bg),
    "--primary": primary,
    "--primary-foreground": readableOn(primary),
    "--ring": primary,
    "--accent": accent,
    "--accent-foreground": readableOn(accent),
    "--radius": THEME_RADII[theme.radius],
    "--site-heading-font": THEME_FONTS[theme.headingFont].stack,
    fontFamily: THEME_FONTS[theme.bodyFont].stack,
  };
}

/** Classes for the themed wrapper: headings take the heading font; `group/site` lets blocks read `data-hero`. */
export const THEMED_SITE_CLASS = "group/site bg-background text-foreground [&_:is(h1,h2,h3)]:[font-family:var(--site-heading-font)]";

export interface ContrastIssue {
  pair: "text" | "button";
  ratio: number;
  message: string;
}

/** WCAG AA (4.5:1) checks the theme form warns about: body text on background, and button text on primary. */
export function themeContrastIssues(theme: WebsiteTheme): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const text = contrastRatio(theme.foreground, theme.background);
  if (text < MIN_CONTRAST) {
    issues.push({ pair: "text", ratio: text, message: `Text on the background is hard to read (${text.toFixed(1)}:1, aim for ${MIN_CONTRAST}:1).` });
  }
  const button = contrastRatio(readableOn(theme.primary), theme.primary);
  if (button < MIN_CONTRAST) {
    issues.push({ pair: "button", ratio: button, message: `Button text on the primary colour is hard to read (${button.toFixed(1)}:1).` });
  }
  return issues;
}
