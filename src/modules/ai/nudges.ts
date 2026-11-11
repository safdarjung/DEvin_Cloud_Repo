// Ask AI orb nudges: shared shape + pure ranking. Sources live in nudges.queries.ts.
export type NudgeKind = "alert" | "suggestion" | "insight";

export interface Nudge {
  /** Stable, derived from the source row, so a dismissal survives refetches. */
  id: string;
  kind: NudgeKind;
  /** Plain language, at most MAX_TEXT chars. */
  text: string;
  /** A page this user can open. */
  href: string;
  /** A ready question for the assistant about this nudge. */
  ask: string;
}

export const MAX_NUDGES = 8;
export const MAX_TEXT = 110;
const KIND_ORDER: Record<NudgeKind, number> = { alert: 0, suggestion: 1, insight: 2 };

export function clipText(text: string, max = MAX_TEXT): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Drops duplicate ids (first wins), clips text, orders alerts, suggestions, insights (stable within a kind), caps at `max`. */
export function rankNudges(nudges: readonly Nudge[], max = MAX_NUDGES): Nudge[] {
  // Same id, or the same sentence from two rows (two insights can share a title): the reader sees one line once.
  const seen = new Set<string>();
  const unique = nudges.filter((n) => !seen.has(n.id) && !seen.has(n.text) && !!seen.add(n.id) && !!seen.add(n.text));
  return unique
    .map((n, i) => ({ n, i }))
    .sort((a, b) => KIND_ORDER[a.n.kind] - KIND_ORDER[b.n.kind] || a.i - b.i)
    .slice(0, max)
    .map(({ n }) => ({ ...n, text: clipText(n.text), ask: clipText(n.ask, 300) }));
}
