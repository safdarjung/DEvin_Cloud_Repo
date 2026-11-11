// Study plan allocation. Pure: callers pass today's IST day. Time is handed
// out in blocks by weighted round robin (weak topics weigh double), then
// merged into one item per topic per day. Nothing lands before today or on or
// after the exam (target) date, and no day exceeds its free minutes.

export interface PlanTopic {
  key: string;
  label: string;
  subjectId: string | null;
  unitId: string | null;
  weak: boolean;
}

export type PlanItemKind = "learn" | "review" | "practice";

export interface PlanItem {
  day: string;
  key: string;
  label: string;
  subjectId: string | null;
  unitId: string | null;
  minutes: number;
  kind: PlanItemKind;
  done: boolean;
}

export interface PlanInput {
  today: string;
  targetDate: string;
  minutesPerDay: number;
  topics: readonly PlanTopic[];
  /** Free minutes per weekday (0 = Sunday); a day's capacity is min(minutesPerDay, this). */
  freeMinutesByWeekday?: Readonly<Partial<Record<number, number>>>;
}

const BLOCK_MINUTES = 15;
const MIN_BLOCK_MINUTES = 10;
const WEAK_WEIGHT = 2;
export const MAX_PLAN_DAYS = 120;
const MAX_DAY_MINUTES = 240;

const weekdayOf = (isoDay: string): number => new Date(`${isoDay}T00:00:00Z`).getUTCDay();
const nextDay = (isoDay: string): string => new Date(Date.parse(`${isoDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Block lengths for one day of `capacity` minutes: 15-minute blocks, or one short block for a 10-14 minute day. */
function blocksFor(capacity: number): number[] {
  if (capacity >= BLOCK_MINUTES) return Array.from({ length: Math.floor(capacity / BLOCK_MINUTES) }, () => BLOCK_MINUTES);
  return capacity >= MIN_BLOCK_MINUTES ? [capacity] : [];
}

export function allocatePlan(input: PlanInput): PlanItem[] {
  const { today, targetDate, minutesPerDay, topics, freeMinutesByWeekday } = input;
  if (topics.length === 0 || targetDate <= today) return [];

  const slots: { day: string; minutes: number }[] = [];
  for (let d = today, n = 0; d < targetDate && n < MAX_PLAN_DAYS; d = nextDay(d), n++) {
    const free = freeMinutesByWeekday?.[weekdayOf(d)] ?? minutesPerDay;
    for (const minutes of blocksFor(Math.min(minutesPerDay, free, MAX_DAY_MINUTES))) slots.push({ day: d, minutes });
  }

  const weights = topics.map((t) => (t.weak ? WEAK_WEIGHT : 1));
  const assigned = topics.map(() => 0);
  const merged: Omit<PlanItem, "kind">[] = [];
  for (const slot of slots) {
    // Lowest (assigned + 1) / weight wins; ties go to the earlier topic.
    let pick = 0;
    for (let i = 1; i < topics.length; i++) {
      if ((assigned[i]! + 1) / weights[i]! < (assigned[pick]! + 1) / weights[pick]!) pick = i;
    }
    assigned[pick]! += 1;
    const t = topics[pick]!;
    const same = merged.find((m) => m.day === slot.day && m.key === t.key);
    if (same) same.minutes += slot.minutes;
    else merged.push({ day: slot.day, key: t.key, label: t.label, subjectId: t.subjectId, unitId: t.unitId, minutes: slot.minutes, done: false });
  }

  return merged.map((item) => {
    const mine = merged.filter((m) => m.key === item.key);
    const kind: PlanItemKind = item === mine[0] ? "learn" : item === mine.at(-1) ? "practice" : "review";
    return { ...item, kind };
  });
}

/**
 * Free minutes per weekday from the student's timetable (periods per weekday,
 * 1 = Monday): days with a full timetable get the chosen minutes, lighter
 * school days 1.5x, days without school periods 2x (capped at 4 hours). No
 * timetable at all: every day gets the chosen minutes.
 */
export function capacityFromTimetable(periodsByWeekday: Readonly<Partial<Record<number, number>>>, minutesPerDay: number): Record<number, number> {
  const full = Math.max(0, ...Object.values(periodsByWeekday).map((p) => p ?? 0));
  const out: Record<number, number> = {};
  for (let w = 0; w <= 6; w++) {
    const periods = periodsByWeekday[w] ?? 0;
    const factor = full === 0 || periods >= full * 0.75 ? 1 : periods > 0 ? 1.5 : 2;
    out[w] = Math.min(MAX_DAY_MINUTES, Math.round(minutesPerDay * factor));
  }
  return out;
}
