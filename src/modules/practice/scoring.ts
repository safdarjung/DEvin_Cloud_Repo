// Pure practice helpers: per-subject averages and the IST-day streak (scores
// are marked only in SQL, submit_practice_session, 0151). No I/O, no
// server-only imports.

const IST_OFFSET_MS = 330 * 60_000;

/** Calendar day (YYYY-MM-DD) of an instant in IST. */
export function istDay(input: Date | string): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Consecutive IST days with activity, counting back from `today`. A streak
 * still counts if today has no activity yet but yesterday does (the student
 * has until midnight to extend it). Inputs are instants or YYYY-MM-DD days.
 */
export function computeStreak(activity: readonly (Date | string)[], now: Date = new Date()): number {
  const days = new Set(activity.map((a) => (typeof a === "string" && a.length === 10 ? a : istDay(a))));
  const today = istDay(now);
  let cursor = days.has(today) ? today : previousDay(today);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}

export interface AttemptScoreRow {
  subjectId: string;
  score: number;
  maxScore: number;
}

export interface SubjectAverage {
  subjectId: string;
  attempts: number;
  /** 0-100, rounded to one decimal; averages each attempt's percentage equally. */
  averagePercent: number;
}

export function subjectAverages(rows: readonly AttemptScoreRow[]): SubjectAverage[] {
  const bySubject = new Map<string, number[]>();
  for (const r of rows) {
    if (r.maxScore <= 0) continue;
    const list = bySubject.get(r.subjectId) ?? [];
    list.push((r.score / r.maxScore) * 100);
    bySubject.set(r.subjectId, list);
  }
  return [...bySubject.entries()].map(([subjectId, pcts]) => ({
    subjectId,
    attempts: pcts.length,
    averagePercent: Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10,
  }));
}
