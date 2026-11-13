// Phase 5 — deterministic revision rules (no AI). Inputs are the per-question
// rows of migration 0151 (online-test items and practice items per student,
// unit and topic), mastery snapshots, and how many approved bank questions can
// be practised. Pure: no I/O, so the rules are unit-tested.

/** Below this percent an area needs revision. */
export const WEAK_PERCENT = 60;
/** Questions needed before a unit or topic can be called weak from question data. */
export const MIN_QUESTIONS = 3;
/** A mastery snapshot counts on its own from this confidence (0..1). */
export const MIN_MASTERY_CONFIDENCE = 0.5;
const MAX_AREAS = 10;

export interface TopicRow {
  studentId: string;
  subjectId: string;
  unitId: string;
  /** null = questions tagged with the unit only. */
  topicId: string | null;
  items: number;
  awarded: number;
  maxMarks: number;
  tests: number;
  practice: number;
  lastOn: string | null;
}

export interface MasteryRow {
  studentId: string;
  subjectId: string;
  unitId: string;
  /** 0..1 */
  score: number;
  /** 0..1 */
  confidence: number;
  markCount: number;
  submissionCount: number;
  testCount: number;
}

export interface BankCount {
  unitId: string;
  topicId: string | null;
  available: number;
}

export interface LearningNames {
  units: ReadonlyMap<string, { title: string; subjectId: string }>;
  topics: ReadonlyMap<string, { title: string; unitId: string; parentId: string | null }>;
}

export interface WeakArea {
  subjectId: string;
  unitId: string;
  unitTitle: string;
  topicId: string | null;
  topicTitle: string | null;
  percent: number;
  evidence: {
    questions: number;
    tests: number;
    practice: number;
    /** Unit mastery (marks, graded work, tests) as a percent, when confident. */
    masteryPercent: number | null;
    lastOn: string | null;
  };
  next: {
    /** "bank" = approved school questions exist; "ai" = generate an AI practice quiz on the unit. */
    practice: "bank" | "ai";
    bankQuestions: number;
    summaryUnitId: string;
    searchQuery: string;
  };
}

const pct = (got: number, of: number) => Math.round((got / of) * 1000) / 10;

interface Totals {
  items: number;
  awarded: number;
  maxMarks: number;
  tests: number;
  practice: number;
  lastOn: string | null;
}

function sum(rows: readonly TopicRow[]): Totals {
  return rows.reduce<Totals>(
    (t, r) => ({
      items: t.items + r.items,
      awarded: t.awarded + r.awarded,
      maxMarks: t.maxMarks + r.maxMarks,
      tests: t.tests + r.tests,
      practice: t.practice + r.practice,
      lastOn: !t.lastOn || (r.lastOn && r.lastOn > t.lastOn) ? r.lastOn : t.lastOn,
    }),
    { items: 0, awarded: 0, maxMarks: 0, tests: 0, practice: 0, lastOn: null },
  );
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

const confident = (m: MasteryRow | undefined) => (m && m.confidence >= MIN_MASTERY_CONFIDENCE ? m : undefined);

function bankFor(counts: readonly BankCount[], names: LearningNames, unitId: string, topicId: string | null): number {
  return counts
    .filter((c) => c.unitId === unitId)
    .filter((c) => topicId === null || c.topicId === topicId || (c.topicId !== null && names.topics.get(c.topicId)?.parentId === topicId))
    .reduce((n, c) => n + c.available, 0);
}

/** One student's weak topics and units, weakest first, each with its next step. */
export function weakAreas(
  rows: readonly TopicRow[],
  mastery: readonly MasteryRow[],
  counts: readonly BankCount[],
  names: LearningNames,
): WeakArea[] {
  const masteryByUnit = new Map(mastery.map((m) => [m.unitId, m]));
  const area = (unitId: string, subjectId: string, topicId: string | null, percent: number, t: Totals): WeakArea => {
    const unitTitle = names.units.get(unitId)?.title ?? "";
    const topicTitle = topicId ? (names.topics.get(topicId)?.title ?? null) : null;
    const bankQuestions = bankFor(counts, names, unitId, topicId);
    const m = confident(masteryByUnit.get(unitId));
    return {
      subjectId,
      unitId,
      unitTitle,
      topicId,
      topicTitle,
      percent,
      evidence: { questions: t.items, tests: t.tests, practice: t.practice, masteryPercent: m ? pct(m.score, 1) : null, lastOn: t.lastOn },
      next: { practice: bankQuestions > 0 ? "bank" : "ai", bankQuestions, summaryUnitId: unitId, searchQuery: topicTitle ?? unitTitle },
    };
  };

  const out: WeakArea[] = [];
  const unitsWithWeakTopic = new Set<string>();
  for (const r of rows) {
    if (r.topicId === null || r.items < MIN_QUESTIONS || r.maxMarks <= 0) continue;
    const p = pct(r.awarded, r.maxMarks);
    if (p >= WEAK_PERCENT) continue;
    out.push(area(r.unitId, r.subjectId, r.topicId, p, sum([r])));
    unitsWithWeakTopic.add(r.unitId);
  }

  const byUnit = groupBy(rows, (r) => r.unitId);
  const unitIds = new Set([...byUnit.keys(), ...mastery.map((m) => m.unitId)]);
  for (const unitId of unitIds) {
    if (unitsWithWeakTopic.has(unitId)) continue;
    const t = sum(byUnit.get(unitId) ?? []);
    const m = confident(masteryByUnit.get(unitId));
    const percent = m ? pct(m.score, 1) : t.items >= MIN_QUESTIONS && t.maxMarks > 0 ? pct(t.awarded, t.maxMarks) : null;
    if (percent === null || percent >= WEAK_PERCENT) continue;
    const subjectId = byUnit.get(unitId)?.[0]?.subjectId ?? m?.subjectId ?? names.units.get(unitId)?.subjectId ?? "";
    out.push(area(unitId, subjectId, null, percent, t));
  }

  return out
    .sort((a, b) => a.percent - b.percent || b.evidence.questions - a.evidence.questions || a.unitTitle.localeCompare(b.unitTitle))
    .slice(0, MAX_AREAS);
}

export interface GapRow {
  unitId: string;
  unitTitle: string;
  topicId: string | null;
  topicTitle: string | null;
  /** Students with question data here. */
  students: number;
  /** Mean of the students' percents; null without question data. */
  averagePercent: number | null;
  /** Students with enough questions and a percent below WEAK_PERCENT. */
  weakStudents: number;
  /** Units only: mean mastery score of the section, percent. */
  masteryAverage: number | null;
}

function gap(rowsByStudent: Map<string, TopicRow[]>, unitId: string, topicId: string | null, names: LearningNames, masteryAverage: number | null): GapRow {
  const per = [...rowsByStudent.values()].map(sum).filter((t) => t.maxMarks > 0);
  const percents = per.map((t) => pct(t.awarded, t.maxMarks));
  return {
    unitId,
    unitTitle: names.units.get(unitId)?.title ?? "",
    topicId,
    topicTitle: topicId ? (names.topics.get(topicId)?.title ?? null) : null,
    students: per.length,
    averagePercent: percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null,
    weakStudents: per.filter((t) => t.items >= MIN_QUESTIONS && pct(t.awarded, t.maxMarks) < WEAK_PERCENT).length,
    masteryAverage,
  };
}

const byWeakness = (a: GapRow, b: GapRow) =>
  (a.averagePercent ?? a.masteryAverage ?? 101) - (b.averagePercent ?? b.masteryAverage ?? 101) || a.unitTitle.localeCompare(b.unitTitle);

/** A section's chapter and topic gaps, weakest first. */
export function sectionGaps(rows: readonly TopicRow[], mastery: readonly MasteryRow[], names: LearningNames): { units: GapRow[]; topics: GapRow[] } {
  const masteryByUnit = groupBy(mastery, (m) => m.unitId);
  const rowsByUnit = groupBy(rows, (r) => r.unitId);
  const units = [...new Set([...rowsByUnit.keys(), ...masteryByUnit.keys()])].map((unitId) => {
    const ms = masteryByUnit.get(unitId) ?? [];
    const masteryAverage = ms.length ? Math.round((ms.reduce((s, m) => s + m.score, 0) / ms.length) * 1000) / 10 : null;
    return gap(groupBy(rowsByUnit.get(unitId) ?? [], (r) => r.studentId), unitId, null, names, masteryAverage);
  });
  const topics = [...groupBy(rows.filter((r) => r.topicId !== null), (r) => `${r.unitId}|${r.topicId}`).values()].map((rs) =>
    gap(groupBy(rs, (r) => r.studentId), rs[0]!.unitId, rs[0]!.topicId, names, null),
  );
  return { units: units.sort(byWeakness), topics: topics.sort(byWeakness) };
}

export interface RevisionStudent {
  studentId: string;
  studentName: string;
  areas: WeakArea[];
}

/** Students of a section who need revision, most weak areas first. */
export function revisionList(
  rows: readonly TopicRow[],
  mastery: readonly MasteryRow[],
  names: LearningNames,
  studentNames: ReadonlyMap<string, string>,
): RevisionStudent[] {
  const rowsBy = groupBy(rows, (r) => r.studentId);
  const masteryBy = groupBy(mastery, (m) => m.studentId);
  return [...new Set([...rowsBy.keys(), ...masteryBy.keys()])]
    .map((studentId) => ({
      studentId,
      studentName: studentNames.get(studentId) ?? "",
      areas: weakAreas(rowsBy.get(studentId) ?? [], masteryBy.get(studentId) ?? [], [], names),
    }))
    .filter((s) => s.areas.length > 0)
    .sort((a, b) => b.areas.length - a.areas.length || a.areas[0]!.percent - b.areas[0]!.percent || a.studentName.localeCompare(b.studentName));
}
