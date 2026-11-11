// Pure helper: turn a section's flat slot list into a period x weekday grid.
import type { SectionTimetableSlot } from "./queries";

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface TimetableGrid {
  /** Weekday numbers (0=Sun..6=Sat) to render, Mon-Sat always, Sunday only when it has slots. */
  days: number[];
  rows: { seq: number; name: string; startsAt: string; endsAt: string; cells: Map<number, SectionTimetableSlot> }[];
}

/** `periods` (optional): teaching periods to show as rows even when empty — the editor needs the free periods too. */
export function buildTimetableGrid(
  slots: SectionTimetableSlot[],
  periods: { seq: number; name: string; startsAt: string; endsAt: string }[] = [],
): TimetableGrid {
  const days = [1, 2, 3, 4, 5, 6];
  if (slots.some((s) => s.weekday === 0)) days.push(0);
  const bySeq = new Map<number, TimetableGrid["rows"][number]>();
  for (const p of periods) bySeq.set(p.seq, { ...p, cells: new Map() });
  for (const s of slots) {
    let row = bySeq.get(s.period.seq);
    if (!row) {
      row = { seq: s.period.seq, name: s.period.name, startsAt: s.period.startsAt, endsAt: s.period.endsAt, cells: new Map() };
      bySeq.set(s.period.seq, row);
    }
    row.cells.set(s.weekday, s);
  }
  return { days, rows: [...bySeq.values()].sort((a, b) => a.seq - b.seq) };
}

/** Weekly period count per subject (no subject = "Period"), most periods first; `display` is the exact count text. */
export function subjectPeriodRows(slots: Pick<SectionTimetableSlot, "subject">[]): { label: string; value: number; display: string }[] {
  const counts = new Map<string, number>();
  for (const s of slots) {
    const name = s.subject?.name ?? "Period";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, display: String(value) }));
}
