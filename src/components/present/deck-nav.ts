// Pure navigation for the /present deck: slide + fragment step, and the one-based URL hash.

export interface DeckPos {
  slide: number;
  /** How many fragments of the slide are revealed (0..frags[slide]). */
  step: number;
}

export type DeckAction = { type: "next" } | { type: "prev" } | { type: "first" } | { type: "last" } | { type: "goto"; slide: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `frags[i]` is the number of fragments slide i reveals one at a time. */
export function deckReducer(frags: readonly number[], pos: DeckPos, action: DeckAction): DeckPos {
  const last = frags.length - 1;
  switch (action.type) {
    case "next":
      if (pos.step < (frags[pos.slide] ?? 0)) return { slide: pos.slide, step: pos.step + 1 };
      return pos.slide < last ? { slide: pos.slide + 1, step: 0 } : pos;
    case "prev":
      if (pos.step > 0) return { slide: pos.slide, step: pos.step - 1 };
      // Going back lands on the previous slide as it was left: fully revealed.
      return pos.slide > 0 ? { slide: pos.slide - 1, step: frags[pos.slide - 1] ?? 0 } : pos;
    case "first":
      return { slide: 0, step: 0 };
    case "last":
      return { slide: last, step: 0 };
    case "goto":
      return { slide: clamp(action.slide, 0, last), step: 0 };
  }
}

export const formatHash = (slide: number): string => `#${slide + 1}`;

/** "#3" is the third slide (index 2); anything else falls back to the first, and big numbers clamp to the last. */
export function parseHash(hash: string, count: number): number {
  const m = /^#(\d+)$/.exec(hash);
  if (!m) return 0;
  return clamp(Number(m[1]) - 1, 0, count - 1);
}
