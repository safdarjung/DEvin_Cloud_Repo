// F18 §H step 2 — colour validation and WCAG contrast. The pattern is the one
// institutions.settings.branding stores; a colour is only ever applied through
// a style object after passing it, never as raw CSS text.
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
export const MIN_CONTRAST = 4.5;

export const isHexColour = (value: string): boolean => HEX_COLOUR.test(value);

// Logo storage (0127 bucket `school-branding`, public read): one file per school
// at `<institution_id>/logo.<ext>`. The storage policies accept only that shape.
export const LOGO_BUCKET = "school-branding";
export const MAX_LOGO_BYTES = 1024 * 1024; // the bucket's file_size_limit
export const LOGO_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type LogoMime = keyof typeof LOGO_EXTENSIONS;

export const isLogoMime = (mime: string): mime is LogoMime => Object.hasOwn(LOGO_EXTENSIONS, mime);

export const logoPathFor = (institutionId: string, mime: LogoMime): string => `${institutionId}/logo.${LOGO_EXTENSIONS[mime]}`;

/** True only for this school's own logo path, as the storage policies write it. */
export function isLogoPathOf(institutionId: string, path: string): boolean {
  const prefix = `${institutionId}/`;
  return path.startsWith(prefix) && /^logo\.(png|jpg|jpeg|webp)$/.test(path.slice(prefix.length));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21) of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour for content placed on `bg`: white when it clears 4.5:1, else near-black. */
export const readableOn = (bg: string): "#ffffff" | "#0a0a0a" => (contrastRatio(bg, "#ffffff") >= MIN_CONTRAST ? "#ffffff" : "#0a0a0a");

/** CSS variables for the tenant layout, or undefined when unset/invalid (default theme). */
export function brandingStyle(color: string | null | undefined): Record<string, string> | undefined {
  if (!color || !isHexColour(color)) return undefined;
  return { "--primary": color, "--primary-foreground": readableOn(color), "--ring": color };
}
