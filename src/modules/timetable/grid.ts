// Pure helper: turn a section's flat slot list into a period x weekday grid.
import type { SectionTimetableSlot } from "./queries";

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface TimetableGrid {
  /** Weekday numbers (0=Sun..6=Sat) to render, Mon-Sat always, Sunday only when it has slots. */
  days: number[];
  rows: { seq: number; name: string; startsAt: string; endsAt: string; cells: Map<number, SectionTimetableSlot> }[];
}

export function buildTimetableGrid(slots: SectionTimetableSlot[]): TimetableGrid {
  const days = [1, 2, 3, 4, 5, 6];
  if (slots.some((s) => s.weekday === 0)) days.push(0);
  const bySeq = new Map<number, TimetableGrid["rows"][number]>();
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
