// Study studio progress maths. Pure: rows come from practice_attempts and
// study_quiz_attempts (questions answered / correct), study_sessions (minutes)
// and the mastery module's gaps. Weeks and days are IST.
import type { MasteryGap } from "@/modules/mastery/rules";
import { istDay } from "@/modules/practice/scoring";
import type { QuizQuestion } from "@/modules/study/formats";
import type { QuizAnswer } from "@/modules/study/quiz";

export interface ScoredRow {
  at: string;
  subjectId: string | null;
  subjectName: string | null;
  unitId: string | null;
  unitTitle: string | null;
  correct: number;
  total: number;
}

export interface AccuracyRow {
  id: string;
  label: string;
  subjectName: string | null;
  correct: number;
  total: number;
  percent: number;
}

export interface WeakTopic {
  label: string;
  subjectName: string | null;
  unitId: string | null;
  percent: number;
  source: "practice" | "mastery";
}

/** Practice evidence needed before a unit can be called weak. */
export const WEAK_MIN_QUESTIONS = 4;
export const WEAK_BELOW_PERCENT = 60;
const MAX_WEAK = 6;

const pct = (correct: number, total: number): number => (total > 0 ? Math.round((correct / total) * 100) : 0);

/** Questions answered and correct, summed per unit or per subject (rows without that id are skipped). */
export function accuracyBy(rows: readonly ScoredRow[], by: "unit" | "subject"): AccuracyRow[] {
  const groups = new Map<string, AccuracyRow>();
  for (const r of rows) {
    const id = by === "unit" ? r.unitId : r.subjectId;
    if (!id || r.total <= 0) continue;
    const g = groups.get(id) ?? { id, label: (by === "unit" ? r.unitTitle : r.subjectName) ?? "", subjectName: r.subjectName, correct: 0, total: 0, percent: 0 };
    groups.set(id, { ...g, correct: g.correct + r.correct, total: g.total + r.total });
  }
  return [...groups.values()].map((g) => ({ ...g, percent: pct(g.correct, g.total) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Units under 60% with enough answered questions, plus mastery gaps not already listed; weakest first. */
export function weakTopics(units: readonly AccuracyRow[], gaps: readonly MasteryGap[] = []): WeakTopic[] {
  const out: WeakTopic[] = units
    .filter((u) => u.total >= WEAK_MIN_QUESTIONS && u.percent < WEAK_BELOW_PERCENT)
    .map((u) => ({ label: u.label, subjectName: u.subjectName, unitId: u.id, percent: u.percent, source: "practice" }));
  const seen = new Set(out.map((w) => w.label.trim().toLowerCase()));
  for (const g of gaps) {
    const key = g.topic.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ label: g.topic, subjectName: g.subject, unitId: null, percent: g.mastery_pct, source: "mastery" });
  }
  return out.sort((a, b) => a.percent - b.percent).slice(0, MAX_WEAK);
}

const dayMs = 86_400_000;
const mondayOf = (isoDay: string): string => {
  const t = Date.parse(`${isoDay}T00:00:00Z`);
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - weekday * dayMs).toISOString().slice(0, 10);
};

/** Accuracy per IST week (Monday start), oldest first; a week with no answers is null. */
export function weeklyAccuracy(rows: readonly ScoredRow[], weeks: number, now: Date = new Date()): { weekStart: string; percent: number | null; total: number }[] {
  const thisWeek = mondayOf(istDay(now));
  const starts = Array.from({ length: weeks }, (_, i) => new Date(Date.parse(`${thisWeek}T00:00:00Z`) - (weeks - 1 - i) * 7 * dayMs).toISOString().slice(0, 10));
  const sums = new Map(starts.map((s) => [s, { correct: 0, total: 0 }]));
  for (const r of rows) {
    const s = sums.get(mondayOf(istDay(r.at)));
    if (s) sums.set(mondayOf(istDay(r.at)), { correct: s.correct + r.correct, total: s.total + r.total });
  }
  return starts.map((weekStart) => {
    const s = sums.get(weekStart)!;
    return { weekStart, percent: s.total > 0 ? pct(s.correct, s.total) : null, total: s.total };
  });
}

/** Study minutes per IST day for the last `days` days (today last). */
export function minutesByDay(sessions: readonly { startedAt: string; minutes: number }[], days: number, now: Date = new Date()): { day: string; minutes: number }[] {
  const today = istDay(now);
  const list = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * dayMs).toISOString().slice(0, 10));
  const totals = new Map(list.map((d) => [d, 0]));
  for (const s of sessions) {
    const d = istDay(s.startedAt);
    if (totals.has(d)) totals.set(d, totals.get(d)! + s.minutes);
  }
  return list.map((day) => ({ day, minutes: totals.get(day)! }));
}

// ---------------------------------------------------------------------------
// Teacher weak spots on shared material: counts and percentages, no names.
// ---------------------------------------------------------------------------

interface AttemptForAccuracy {
  questions: readonly QuizQuestion[];
  answers: readonly QuizAnswer[];
  aiChecks: readonly { score: number }[];
}

/** % right per question across attempts, grouped by question text (each attempt carries its own snapshot); weakest first. */
export function questionAccuracy(attempts: readonly AttemptForAccuracy[]): { stem: string; percent: number; answered: number }[] {
  const tally = new Map<string, { right: number; answered: number }>();
  for (const a of attempts) {
    const shortScores = [...a.aiChecks];
    a.questions.forEach((q, i) => {
      const answer = a.answers[i] ?? null;
      const check = q.type === "short" ? shortScores.shift() : undefined;
      if (answer === null || (q.type === "short" && !check)) return;
      const right = q.type === "mcq" ? answer === q.answerIndex : q.type === "true_false" ? answer === q.answer : check!.score === 2;
      const t = tally.get(q.stem) ?? { right: 0, answered: 0 };
      tally.set(q.stem, { right: t.right + (right ? 1 : 0), answered: t.answered + 1 });
    });
  }
  return [...tally.entries()]
    .map(([stem, t]) => ({ stem, percent: pct(t.right, t.answered), answered: t.answered }))
    .sort((a, b) => a.percent - b.percent || b.answered - a.answered);
}

/** Cards that students have missed at least once, by how many students missed them; most-missed first. */
export function cardLapses(
  cards: readonly { id: string; front: string }[],
  states: readonly Readonly<Record<string, { lapses: number }>>[],
): { front: string; students: number }[] {
  return cards
    .map((c) => ({ front: c.front, students: states.filter((s) => (s[c.id]?.lapses ?? 0) > 0).length }))
    .filter((c) => c.students > 0)
    .sort((a, b) => b.students - a.students);
}
