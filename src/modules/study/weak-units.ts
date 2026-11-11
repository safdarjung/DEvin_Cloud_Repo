// Weakest units for a revision pack (student) or a class revision pack
// (section aggregate). Pure and deterministic: evidence rows come from
// practice_attempts and study_quiz_attempts (questions answered / correct)
// and mastery_snapshots; only units in `allowed` (the student's own subjects,
// or the section's subjects) can ever be returned.

export interface UnitInfo {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
}

export interface UnitEvidence {
  unitId: string;
  correct: number;
  total: number;
  at: string;
}

export interface MasteryEvidence {
  unitId: string;
  /** 0..1 */
  score: number;
  /** 0..1 */
  confidence: number;
  computedAt: string;
}

export interface WeakUnit {
  unitId: string;
  title: string;
  subjectId: string;
  subjectName: string;
  /** Recency-weighted accuracy, 0..100. */
  accuracy: number;
  /** Questions actually answered on this unit (unweighted). */
  questions: number;
}

/** Evidence half-life: an answer 14 days old counts half as much as one today. */
export const HALF_LIFE_DAYS = 14;
/** Answered questions needed before a unit can be called weak (unless a confident mastery snapshot exists). */
export const MIN_EVIDENCE_QUESTIONS = 4;
/** A confident mastery snapshot counts as this many questions (times its confidence). */
export const MASTERY_WEIGHT = 5;
export const MASTERY_MIN_CONFIDENCE = 0.5;
/** Units at or above this accuracy are not weak. */
export const WEAK_BELOW = 75;
export const PACK_MAX_UNITS = 3;

const DAY_MS = 86_400_000;

function recency(at: string, now: Date): number {
  const age = Math.max(0, (now.getTime() - Date.parse(at)) / DAY_MS);
  return Number.isFinite(age) ? 0.5 ** (age / HALF_LIFE_DAYS) : 0;
}

export function selectWeakUnits(input: {
  allowed: readonly UnitInfo[];
  evidence: readonly UnitEvidence[];
  mastery: readonly MasteryEvidence[];
  now: Date;
  limit?: number;
}): WeakUnit[] {
  const allowed = new Map(input.allowed.map((u) => [u.id, u]));
  const acc = new Map<string, { wc: number; wt: number; questions: number; mastery: boolean }>();
  const slot = (id: string) => acc.get(id) ?? { wc: 0, wt: 0, questions: 0, mastery: false };

  for (const e of input.evidence) {
    if (!allowed.has(e.unitId) || !(e.total > 0)) continue;
    const w = recency(e.at, input.now);
    const s = slot(e.unitId);
    acc.set(e.unitId, { ...s, wc: s.wc + w * Math.min(e.correct, e.total), wt: s.wt + w * e.total, questions: s.questions + e.total });
  }

  // Latest confident snapshot per unit only.
  const latest = new Map<string, MasteryEvidence>();
  for (const m of input.mastery) {
    if (!allowed.has(m.unitId) || m.confidence < MASTERY_MIN_CONFIDENCE) continue;
    const prev = latest.get(m.unitId);
    if (!prev || m.computedAt > prev.computedAt) latest.set(m.unitId, m);
  }
  for (const m of latest.values()) {
    const pseudo = MASTERY_WEIGHT * m.confidence * recency(m.computedAt, input.now);
    const s = slot(m.unitId);
    acc.set(m.unitId, { ...s, wc: s.wc + pseudo * m.score, wt: s.wt + pseudo, mastery: true });
  }

  const out: WeakUnit[] = [];
  for (const [unitId, s] of acc) {
    if (s.wt <= 0 || (s.questions < MIN_EVIDENCE_QUESTIONS && !s.mastery)) continue;
    const accuracy = Math.round((s.wc / s.wt) * 100);
    if (accuracy >= WEAK_BELOW) continue;
    const u = allowed.get(unitId)!;
    out.push({ unitId, title: u.title, subjectId: u.subjectId, subjectName: u.subjectName, accuracy, questions: s.questions });
  }
  return out
    .sort((a, b) => a.accuracy - b.accuracy || b.questions - a.questions || a.title.localeCompare(b.title) || a.unitId.localeCompare(b.unitId))
    .slice(0, input.limit ?? PACK_MAX_UNITS);
}
