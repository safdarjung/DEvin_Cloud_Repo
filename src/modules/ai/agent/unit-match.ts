// Matching a unit title the way a teacher says it: "acid bases and salts" finds "Acids, Bases and Salts",
// "chapter 2 light" finds "Light: Reflection and Refraction". Pure.
const STOP = new Set(["a", "an", "the", "and", "of", "in", "on", "for", "to", "chapter", "unit", "lesson", "topic", "class", "grade", "std", "my", "i", "teach"]);

/** Lower-case words that carry meaning, with a plural "s" dropped ("acids" -> "acid"). */
export function unitSearchWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+(st|nd|rd|th)?$/.test(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(words)].slice(0, 8);
}

/** Share of the search words found in the title (0..1). */
export function unitTitleScore(title: string, words: readonly string[]): number {
  if (words.length === 0) return 0;
  const t = title.toLowerCase();
  return words.filter((w) => t.includes(w)).length / words.length;
}
