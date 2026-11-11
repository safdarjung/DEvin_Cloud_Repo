// 0141 — pure checks over a timetable: the rule-violation checklist shown
// before publishing, the slot-level diff between two versions, the
// compensating change a rollback applies, and the substitute ranking. No I/O.
// Relative .ts imports (seed-script safe).
import { RULE_CATALOG, type RuleCode, type TimetableRules } from "./rules.ts";
import { runLength, WEEKDAY_SHORT, type Band } from "./suggest.ts";

export interface CellRef {
  classSectionId: string;
  weekday: number;
  periodId: string;
}

export interface CellContent {
  subjectId: string;
  teacherId: string;
  roomId: string | null;
}

export type CellSlot = CellRef & CellContent;

export interface Violation {
  rule: RuleCode;
  sectionId?: string;
  teacherId?: string;
  message: string;
}

export interface CheckModel {
  periods: { id: string; seq: number; name: string; band?: Band }[];
  slots: CellSlot[];
  rooms: { id: string; name: string; kind?: string }[];
  rules: TimetableRules;
  sectionLabels: Record<string, string>;
  subjectNames: Record<string, string>;
  teacherNames: Record<string, string>;
}

const k = (...parts: (string | number)[]) => parts.join("|");
const inc = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

/** Every enabled rule the timetable currently breaks, in a stable order. Double-booking is not here: the database refuses it. */
export function checkViolations(m: CheckModel): Violation[] {
  const { rules } = m;
  const sec = (id: string) => m.sectionLabels[id] ?? "a class";
  const sub = (id: string) => m.subjectNames[id] ?? "a subject";
  const tea = (id: string) => m.teacherNames[id] ?? "a teacher";
  const period = new Map(m.periods.map((p) => [p.id, p]));
  const roomKind = new Map(m.rooms.map((r) => [r.id, r.kind ?? ""]));
  const out: Violation[] = [];

  const subjectDay = new Map<string, number>();
  const teacherWeek = new Map<string, number>();
  const teacherDay = new Map<string, number>();
  const teacherSeqs = new Map<string, Set<number>>();
  const subjectDays = new Map<string, Map<number, number>>();
  for (const s of m.slots) {
    inc(subjectDay, k(s.classSectionId, s.weekday, s.subjectId));
    inc(teacherWeek, s.teacherId);
    inc(teacherDay, k(s.teacherId, s.weekday));
    const seq = period.get(s.periodId)?.seq;
    if (seq !== undefined) {
      const seqs = teacherSeqs.get(k(s.teacherId, s.weekday)) ?? new Set<number>();
      seqs.add(seq);
      teacherSeqs.set(k(s.teacherId, s.weekday), seqs);
    }
    const days = subjectDays.get(k(s.classSectionId, s.subjectId)) ?? new Map<number, number>();
    days.set(s.weekday, (days.get(s.weekday) ?? 0) + 1);
    subjectDays.set(k(s.classSectionId, s.subjectId), days);

    const p = period.get(s.periodId);
    if (rules.teacher_unavailable.enabled) {
      const hit = rules.teacher_unavailable.value.some((u) => u.teacherId === s.teacherId && u.weekday === s.weekday && (!u.periodId || u.periodId === s.periodId));
      if (hit)
        out.push({
          rule: "teacher_unavailable",
          sectionId: s.classSectionId,
          teacherId: s.teacherId,
          message: `${tea(s.teacherId)} is unavailable but teaches ${sec(s.classSectionId)} on ${WEEKDAY_SHORT[s.weekday]} ${p?.name ?? ""}`.trim(),
        });
    }
    if (rules.subject_time_band.enabled && p?.band) {
      const want = rules.subject_time_band.value.find((b) => b.subjectId === s.subjectId)?.band;
      if (want && want !== p.band)
        out.push({
          rule: "subject_time_band",
          sectionId: s.classSectionId,
          message: `${sec(s.classSectionId)} has ${sub(s.subjectId)} ${p.band === "after_lunch" ? "after" : "before"} lunch on ${WEEKDAY_SHORT[s.weekday]} ${p.name}`,
        });
    }
    if (rules.lab_rooms.enabled && rules.lab_rooms.value.includes(s.subjectId) && roomKind.get(s.roomId ?? "") !== "lab")
      out.push({
        rule: "lab_rooms",
        sectionId: s.classSectionId,
        message: `${sec(s.classSectionId)} has ${sub(s.subjectId)} outside a lab on ${WEEKDAY_SHORT[s.weekday]} ${p?.name ?? ""}`.trim(),
      });
  }

  if (rules.max_same_subject_per_day.enabled)
    for (const [key, n] of subjectDay) {
      if (n <= rules.max_same_subject_per_day.value) continue;
      const [sectionId, weekday, subjectId] = key.split("|");
      out.push({
        rule: "max_same_subject_per_day",
        sectionId,
        message: `${sec(sectionId)} has ${n} ${sub(subjectId)} on ${WEEKDAY_SHORT[Number(weekday)]} (max ${rules.max_same_subject_per_day.value})`,
      });
    }
  if (rules.max_teacher_per_week.enabled)
    for (const [teacherId, n] of teacherWeek)
      if (n > rules.max_teacher_per_week.value)
        out.push({ rule: "max_teacher_per_week", teacherId, message: `${tea(teacherId)} has ${n} periods a week (max ${rules.max_teacher_per_week.value})` });
  if (rules.max_teacher_per_day.enabled)
    for (const [key, n] of teacherDay) {
      if (n <= rules.max_teacher_per_day.value) continue;
      const [teacherId, weekday] = key.split("|");
      out.push({
        rule: "max_teacher_per_day",
        teacherId,
        message: `${tea(teacherId)} has ${n} periods on ${WEEKDAY_SHORT[Number(weekday)]} (max ${rules.max_teacher_per_day.value})`,
      });
    }
  if (rules.max_consecutive_teacher.enabled)
    for (const [key, seqs] of teacherSeqs) {
      const longest = Math.max(...[...seqs].map((s) => runLength(seqs, s)));
      if (longest <= rules.max_consecutive_teacher.value) continue;
      const [teacherId, weekday] = key.split("|");
      out.push({
        rule: "max_consecutive_teacher",
        teacherId,
        message: `${tea(teacherId)} teaches ${longest} periods in a row on ${WEEKDAY_SHORT[Number(weekday)]} (max ${rules.max_consecutive_teacher.value})`,
      });
    }
  if (rules.spread_across_week.enabled)
    for (const [key, days] of subjectDays) {
      const total = [...days.values()].reduce((a, b) => a + b, 0);
      const crowded = [...days].filter(([, n]) => n > rules.spread_across_week.value).map(([d]) => d);
      if (crowded.length === 0 || days.size >= Math.min(total, 6)) continue;
      const [sectionId, subjectId] = key.split("|");
      out.push({
        rule: "spread_across_week",
        sectionId,
        message: `${sec(sectionId)} has ${sub(subjectId)} more than ${rules.spread_across_week.value} a day on ${crowded.sort().map((d) => WEEKDAY_SHORT[d]).join(", ")} but only on ${days.size} days`,
      });
    }

  return out.sort((a, b) => a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message));
}

export function violationLabel(rule: RuleCode): string {
  return RULE_CATALOG[rule].label;
}

export interface DiffRow extends CellRef {
  kind: "added" | "removed" | "changed";
  before: CellContent | null;
  after: CellContent | null;
}

const cellKey = (c: CellRef) => k(c.classSectionId, c.weekday, c.periodId);
const content = (s: CellSlot): CellContent => ({ subjectId: s.subjectId, teacherId: s.teacherId, roomId: s.roomId ?? null });
const same = (a: CellContent, b: CellContent) => a.subjectId === b.subjectId && a.teacherId === b.teacherId && (a.roomId ?? null) === (b.roomId ?? null);

/** Cell-level differences going from `from` to `to` (section, weekday, period order). */
export function diffSlots(from: CellSlot[], to: CellSlot[]): DiffRow[] {
  const a = new Map(from.map((s) => [cellKey(s), s]));
  const b = new Map(to.map((s) => [cellKey(s), s]));
  const rows: DiffRow[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    const ref = (x ?? y)!;
    const cell = { classSectionId: ref.classSectionId, weekday: ref.weekday, periodId: ref.periodId };
    if (x && !y) rows.push({ ...cell, kind: "removed", before: content(x), after: null });
    else if (!x && y) rows.push({ ...cell, kind: "added", before: null, after: content(y) });
    else if (x && y && !same(content(x), content(y))) rows.push({ ...cell, kind: "changed", before: content(x), after: content(y) });
  }
  return rows.sort((p, q) => p.classSectionId.localeCompare(q.classSectionId) || p.weekday - q.weekday || p.periodId.localeCompare(q.periodId));
}

/** One apply_timetable_changes entry (see 0141). `expect` guards against a cell that changed since. */
export interface CellChange extends CellRef {
  after: CellContent | null;
  expect?: CellContent | null;
  reason?: string;
  rules?: string[];
}

/** The changes that turn `current` into `target`, each guarded by what the cell holds now. */
export function changesToReach(current: CellSlot[], target: CellSlot[], reason: string): CellChange[] {
  return diffSlots(current, target).map((d) => ({
    classSectionId: d.classSectionId,
    weekday: d.weekday,
    periodId: d.periodId,
    after: d.after,
    expect: d.before,
    reason,
  }));
}

export interface LoggedCellChange extends CellRef {
  kind: string;
  label: string | null;
  reason: string;
  before: CellContent | null;
  after: CellContent | null;
}

/**
 * The compensating change for an undo: put back `before`, but only if the
 * cell still holds this change's `after` (else a later change would be lost).
 */
export function rollbackChange(change: LoggedCellChange, note?: string): CellChange {
  const extra = note?.trim() ? ` Note: ${note.trim()}` : "";
  return {
    classSectionId: change.classSectionId,
    weekday: change.weekday,
    periodId: change.periodId,
    after: change.before,
    expect: change.after,
    reason: `Rollback of: ${change.reason}${extra}`.slice(0, 500),
  };
}

export interface SubstituteCandidate {
  staffId: string;
  name: string;
  periodsWeek: number;
  periodsToday: number;
  teachesSubject: boolean;
  teachesGrade: boolean;
  coveringToday: number;
}

export type RankedSubstitute = SubstituteCandidate & { score: number; why: string };

/** Off: fewest periods a week, then name (the pre-0141 order). On: weighted points, ties as before. */
export function rankSubstitutes(cands: SubstituteCandidate[], rules: TimetableRules, subjectName = "the subject"): RankedSubstitute[] {
  const r = rules.substitute_ranking;
  const ranked = cands.map((c) => {
    const facts = [
      c.teachesSubject ? `teaches ${subjectName}` : null,
      c.teachesGrade ? "teaches this grade" : null,
      `${c.periodsToday} periods that day`,
      c.coveringToday > 0 ? `already covering ${c.coveringToday}` : "not covering",
      `${c.periodsWeek} a week`,
    ].filter(Boolean);
    const score = r.enabled
      ? (c.teachesSubject ? r.value.sameSubject : 0) +
        (c.teachesGrade ? r.value.sameGrade : 0) +
        (c.coveringToday === 0 ? r.value.notCovering : 0) -
        c.periodsToday * r.value.fewestToday
      : 0;
    return { ...c, score, why: facts.join(", ") };
  });
  return ranked.sort((a, b) => b.score - a.score || a.periodsWeek - b.periodsWeek || a.name.localeCompare(b.name));
}
