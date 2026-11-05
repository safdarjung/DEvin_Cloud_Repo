// M25-T3 — timetable fill engine fill_v1 (M25 rulings "Engine fill_v1"). Pure and deterministic:
// no I/O, clock or randomness; output depends only on the input, not on array order.
// Relative .ts imports (seed-script safe, like schemas.ts).
import type { InsightAction } from "../fabric/types.ts";
import type { SlotInput } from "./schemas.ts";

export const SUGGEST_ENGINE_VERSION = 1;
export const MAX_SAME_SUBJECT_PER_DAY = 2;

const WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;
const WEEKDAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OWNER = "Timetable manager";
// M19 record_insight_action text limits.
const ACTION_MAX = 200;
const RATIONALE_MAX = 500;
const OUTCOME_MAX = 300;

export interface SuggestInput {
  /** Non-break periods. */
  periods: { id: string; seq: number; name: string }[];
  /** In-scope sections only. */
  sections: { id: string; label: string }[];
  /** Assignments whose teacher is active. */
  assignments: { classSectionId: string; subjectId: string; subjectName: string; teacherId: string; teacherName: string }[];
  /** Every slot of the version (all sections). */
  slots: { classSectionId: string; weekday: number; periodId: string; subjectId: string; teacherId: string; roomId: string | null }[];
  rooms: { id: string; name: string }[];
  maxPeriodsWeek: number;
  limit: number;
}

export type TimetableSuggestion = Pick<InsightAction, "action" | "owner" | "rationale" | "expected_outcome"> & {
  status: "planned";
  slot: SlotInput;
};

type Assignment = SuggestInput["assignments"][number];
type Candidate = { a: Assignment; target: number };

const key = (...parts: (string | number)[]) => parts.join("|");
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Occupancy of the whole version: busy cells, teacher load, per-day and per-week subject counts. */
function occupancy(slots: SuggestInput["slots"]) {
  const busy = new Set<string>(); // cells keyed "s|section|…", "t|teacher|…", "r|room|…"
  const load = new Map<string, number>();
  const dayCount = new Map<string, number>();
  const count = new Map<string, number>();
  for (const s of slots) {
    busy.add(key("s", s.classSectionId, s.weekday, s.periodId));
    busy.add(key("t", s.teacherId, s.weekday, s.periodId));
    if (s.roomId) busy.add(key("r", s.roomId, s.weekday, s.periodId));
    bump(load, s.teacherId);
    bump(dayCount, key(s.classSectionId, s.weekday, s.subjectId));
    bump(count, key(s.classSectionId, s.subjectId));
  }
  return { busy, load, dayCount, count };
}

/** Room with the most slots of the section in the version (ties: name, then id); none -> null. */
function homeRoom(sectionId: string, slots: SuggestInput["slots"], roomName: Map<string, string>): string | null {
  const uses = new Map<string, number>();
  for (const s of slots) if (s.classSectionId === sectionId && s.roomId && roomName.has(s.roomId)) bump(uses, s.roomId);
  const ranked = [...uses].sort(
    ([a, na], [b, nb]) => nb - na || roomName.get(a)!.localeCompare(roomName.get(b)!, "en") || byId(a, b),
  );
  return ranked[0]?.[0] ?? null;
}

/** Section's assignments by subject name, then id, with fill_v1 per-subject weekly targets. */
function candidates(sectionId: string, assignments: Assignment[], cellsPerWeek: number): Candidate[] {
  const list = assignments
    .filter((a) => a.classSectionId === sectionId)
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "en") || byId(a.subjectId, b.subjectId));
  const k = list.length;
  return list.map((a, i) => ({ a, target: Math.floor(cellsPerWeek / k) + (i < cellsPerWeek % k ? 1 : 0) }));
}

type Occupancy = ReturnType<typeof occupancy>;
type Cell = { sectionId: string; weekday: number; periodId: string };

/** fill_v1 step 5: feasible candidate with the largest deficit, then the lower teacher load. */
function pick(cands: Candidate[], occ: Occupancy, cell: Cell, maxPeriodsWeek: number) {
  let best: { c: Candidate; deficit: number; load: number } | null = null;
  for (const c of cands) {
    const deficit = c.target - (occ.count.get(key(cell.sectionId, c.a.subjectId)) ?? 0);
    const load = occ.load.get(c.a.teacherId) ?? 0;
    if (deficit <= 0 || load >= maxPeriodsWeek) continue;
    if (occ.busy.has(key("t", c.a.teacherId, cell.weekday, cell.periodId))) continue;
    if ((occ.dayCount.get(key(cell.sectionId, cell.weekday, c.a.subjectId)) ?? 0) >= MAX_SAME_SUBJECT_PER_DAY) continue;
    // cands are in subject name/id order, so strict comparison keeps that tie-break.
    if (!best || deficit > best.deficit || (deficit === best.deficit && load < best.load)) best = { c, deficit, load };
  }
  return best?.c ?? null;
}

/** fill_v1 step 7 texts; `had` = the section's periods of the subject before this suggestion. */
function texts(section: string, period: SuggestInput["periods"][number], weekday: number, c: Candidate, had: number, room: string | null) {
  const { subjectName: subject, teacherName: teacher } = c.a;
  const where = `${WEEKDAY_NAMES[weekday]} period ${period.seq} (${period.name})`;
  return {
    action: cut(`Add ${subject} to ${section}, ${where}, with ${teacher}${room ? ` in ${room}` : ""}`, ACTION_MAX),
    owner: OWNER,
    rationale: cut(
      `${teacher} is free in this period${room ? ` and ${room} is free` : ""}; ${subject} has ${had} of ${c.target} periods a week in ${section}.`,
      RATIONALE_MAX,
    ),
    expected_outcome: cut(`${section} ${subject}: ${had + 1} of ${c.target} periods a week.`, OUTCOME_MAX),
  };
}

export function suggestFill(input: SuggestInput): {
  suggestions: TimetableSuggestion[];
  unfilled: number;
  truncated: boolean;
} {
  const periods = [...input.periods].sort((a, b) => a.seq - b.seq || byId(a.id, b.id));
  const sections = [...input.sections].sort(
    (a, b) => a.label.localeCompare(b.label, "en", { numeric: true }) || byId(a.id, b.id),
  );
  const roomName = new Map(input.rooms.map((r) => [r.id, r.name]));
  const cellsPerWeek = WEEKDAYS.length * periods.length;
  const occ = occupancy(input.slots);

  const suggestions: TimetableSuggestion[] = [];
  let empty = 0;
  let truncated = false;
  for (const section of sections) {
    const cands = candidates(section.id, input.assignments, cellsPerWeek);
    const home = homeRoom(section.id, input.slots, roomName);
    for (const weekday of WEEKDAYS) {
      for (const period of periods) {
        if (occ.busy.has(key("s", section.id, weekday, period.id))) continue;
        empty++; // a suggestion fills only its own cell, so this counts the empty cells before the pass
        if (truncated) continue;
        const c = pick(cands, occ, { sectionId: section.id, weekday, periodId: period.id }, input.maxPeriodsWeek);
        if (!c) continue;
        if (suggestions.length === input.limit) {
          truncated = true; // a further feasible suggestion exists past the limit
          continue;
        }

        const room = home !== null && !occ.busy.has(key("r", home, weekday, period.id)) ? home : null;
        const had = occ.count.get(key(section.id, c.a.subjectId)) ?? 0;
        const slot = { classSectionId: section.id, weekday, periodId: period.id, subjectId: c.a.subjectId, teacherId: c.a.teacherId };
        suggestions.push({
          ...texts(section.label, period, weekday, c, had, room && roomName.get(room)!),
          status: "planned",
          slot: room ? { ...slot, roomId: room } : slot,
        });
        occ.busy.add(key("s", section.id, weekday, period.id));
        occ.busy.add(key("t", c.a.teacherId, weekday, period.id));
        if (room) occ.busy.add(key("r", room, weekday, period.id));
        bump(occ.load, c.a.teacherId);
        bump(occ.dayCount, key(section.id, weekday, c.a.subjectId));
        bump(occ.count, key(section.id, c.a.subjectId));
      }
    }
  }
  return { suggestions, unfilled: empty - suggestions.length, truncated };
}
