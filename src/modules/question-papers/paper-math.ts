// Pure helpers shared by the print renderer and the generator. Kept free of
// server imports so unit tests and the UI can use them.

/** xmur3 string hash -> mulberry32 PRNG: same seed, same sequence, every run. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates on a copy. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface MarkedItem {
  marks: number;
  choiceGroup: number | null;
}

/** Groups items into slots: an OR group is one slot, every other item its own. Order of first appearance. */
export function slots<T extends MarkedItem>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  const byGroup = new Map<number, T[]>();
  for (const item of items) {
    if (item.choiceGroup === null) {
      out.push([item]);
      continue;
    }
    const existing = byGroup.get(item.choiceGroup);
    if (existing) existing.push(item);
    else {
      const slot = [item];
      byGroup.set(item.choiceGroup, slot);
      out.push(slot);
    }
  }
  return out;
}

/** Marks a section is worth: an OR slot counts its highest item; chooseCount keeps the best N slots (mirrors app.validate_paper). */
export function sectionMarks(items: readonly MarkedItem[], chooseCount: number | null): number {
  const values = slots(items)
    .map((slot) => Math.max(...slot.map((i) => i.marks)))
    .sort((a, b) => b - a);
  const kept = chooseCount === null ? values : values.slice(0, chooseCount);
  return Math.round(kept.reduce((sum, m) => sum + m, 0) * 100) / 100;
}
