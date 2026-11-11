// Language variants of a study material (0140 study_materials.language /
// variant_of). Translation keeps the structure exactly: only the strings a
// reader sees are sent to the model as a flat list and written back in the
// same order; ids, types, answer keys, indexes and difficulty never change.

export const VARIANT_LANGUAGES = ["en", "hi"] as const;
export type VariantLanguage = (typeof VARIANT_LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<VariantLanguage, string> = { en: "English", hi: "हिन्दी" };
export const LANGUAGE_NAMES: Record<VariantLanguage, string> = { en: "English", hi: "Hindi" };

/** Keys whose string values are identifiers or settings, not reader text. */
const SKIP_KEYS = new Set(["id", "type", "difficulty", "level", "paperId"]);
export const MAX_VARIANT_STRINGS = 400;
export const MAX_VARIANT_CHARS = 24_000;

function walk(value: unknown, visit: (s: string) => string): unknown {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, visit));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SKIP_KEYS.has(k) ? v : walk(v, visit)]));
  }
  return value;
}

/** Every reader-visible string, depth-first in stored key order. Blank strings are skipped (and left blank on write-back). */
export function collectStrings(content: unknown): string[] {
  const out: string[] = [];
  walk(content, (s) => {
    if (s.trim()) out.push(s);
    return s;
  });
  return out;
}

/** A copy of `content` with each non-empty string replaced in order; null when the counts differ. */
export function applyStrings(content: unknown, strings: readonly string[]): unknown {
  if (strings.length !== collectStrings(content).length) return null;
  let i = 0;
  return walk(content, (s) => (s.trim() ? strings[i++]!.trim() || s : s));
}
