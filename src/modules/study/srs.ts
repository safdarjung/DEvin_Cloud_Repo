// Study studio flashcards: a five-box Leitner schedule. Pure (no I/O, no
// clock): callers pass today's IST day as YYYY-MM-DD. Per-card state lives in
// study_deck_progress.state as { [cardId]: CardState }.
import { z } from "zod";

export const REVIEW_GRADES = ["knew", "almost", "missed"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const MAX_BOX = 5;
// Days until the next review after a "knew", by the box the card lands in.
const INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CardStateSchema = z
  .object({
    box: z.number().int().min(1).max(MAX_BOX),
    due: day,
    reps: z.number().int().min(0),
    lapses: z.number().int().min(0),
    last: day,
  })
  .strict();
export type CardState = z.infer<typeof CardStateSchema>;
export const DeckStateSchema = z.record(z.string().max(40), CardStateSchema);

export function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Next state after one review. "missed" restarts the card; "almost" keeps its box; both come back tomorrow. */
export function reviewCard(prev: CardState | undefined, grade: ReviewGrade, today: string): CardState {
  const box = prev?.box ?? 0;
  const reps = (prev?.reps ?? 0) + 1;
  const lapses = (prev?.lapses ?? 0) + (grade === "missed" ? 1 : 0);
  if (grade === "knew") {
    const next = Math.min(MAX_BOX, box + 1);
    return { box: next, due: addDays(today, INTERVAL_DAYS[next]!), reps, lapses, last: today };
  }
  const next = grade === "missed" ? 1 : Math.max(1, box);
  return { box: next, due: addDays(today, 1), reps, lapses, last: today };
}

/** Reviewed cards due on or before today, earliest first. Never-reviewed cards are "new", not due. */
export function dueCardIds(cards: readonly { id: string }[], states: Readonly<Record<string, CardState>>, today: string): string[] {
  return cards
    .filter((c) => states[c.id] && states[c.id]!.due <= today)
    .sort((a, b) => states[a.id]!.due.localeCompare(states[b.id]!.due) || states[a.id]!.box - states[b.id]!.box)
    .map((c) => c.id);
}

/** One drill: every due card, then up to `newLimit` never-reviewed cards in deck order. */
export function drillQueue(cards: readonly { id: string }[], states: Readonly<Record<string, CardState>>, today: string, newLimit = 10): string[] {
  const fresh = cards.filter((c) => !states[c.id]).slice(0, Math.max(0, newLimit)).map((c) => c.id);
  return [...dueCardIds(cards, states, today), ...fresh];
}
