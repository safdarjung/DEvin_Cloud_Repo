// M25-T3 — timetable fill engine fill_v1 (M25 rulings "Engine fill_v1"). Pure and deterministic:
// no I/O, clock or randomness; output depends only on the input, not on array order.
// 0141: the rules are per-school (./rules.ts) instead of constants; with the default
// rules the slots chosen are exactly fill_v1's. Every suggestion names the rules it
// kept and the candidates it passed over, each with the rule that ruled them out.
// Relative .ts imports (seed-script safe, like schemas.ts).
import type { InsightAction } from "../fabric/types.ts";
import type { SlotInput } from "./schemas.ts";
import { defaultRules, RULE_CATALOG, type RuleCode, type TimetableRules } from "./rules.ts";

export const SUGGEST_ENGINE_VERSION = 1;
/** fill_v1's fixed cap; now the default of rules.max_same_subject_per_day. */
export const MAX_SAME_SUBJECT_PER_DAY = 2;

const WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;
export const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OWNER = "Timetable manager";
// M19 record_insight_action text limits.
const ACTION_MAX = 200;
const RATIONALE_MAX = 500;
const OUTCOME_MAX = 300;

export type Band = "before_lunch" | "after_lunch";

export interface SuggestInput {
  /** Non-break periods; `band` is set by the loader from the lunch break. */
  periods: { id: string; seq: number; name: string; band?: Band }[];
  /** In-scope sections only. */
  sections: { id: string; label: string }[];
  /** Assignments whose teacher is active. */
  assignments: { classSectionId: string; subjectId: string; subjectName: string; teacherId: string; teacherName: string }[];
  /** Every slot of the version (all sections). */
  slots: { classSectionId: string; weekday: number; periodId: string; subjectId: string; teacherId: string; roomId: string | null }[];
  rooms: { id: string; name: string; kind?: string }[];
  maxPeriodsWeek: number;
  limit: number;
  /** Omitted: defaultRules(maxPeriodsWeek), i.e. fill_v1. */
  rules?: TimetableRules;
}

/** Why a candidate was not chosen for a cell ("why not Ms X?"). */
export interface Rejection {
  subject: string;
  teacher: string;
  teacherId: string;
  rule: RuleCode | "teacher_busy" | "target_met" | "ranked_lower";
  reason: string;
}

export type TimetableSuggestion = Pick<InsightAction, "action" | "owner" | "rationale" | "expected_outcome"> & {
  status: "planned";
  slot: SlotInput;
  /** "fill_target" (the subject is short of its weekly share) plus every enabled rule the choice kept. */
  rules: (RuleCode | "fill_target")[];
  alternatives: Rejection[];
};

type Assignment = SuggestInput["assignments"][number];
type Candidate = { a: Assignment; target: number };
type Period = SuggestInput["periods"][number];

const key = (...parts: (string | number)[]) => parts.join("|");
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Occupancy of the whole version: busy cells, teacher loads, per-day and per-week subject counts. */
function occupancy(slots: SuggestInput["slots"], seqOf: Map<string, number>) {
  const busy = new Set<string>(); // cells keyed "s|section|…", "t|teacher|…", "r|room|…"
  const load = new Map<string, number>();
  const dayLoad = new Map<string, number>(); // teacher|weekday
  const teacherSeqs = new Map<string, Set<number>>(); // teacher|weekday
  const dayCount = new Map<string, number>(); // section|weekday|subject
  const count = new Map<string, number>(); // section|subject
  const occ = { busy, load, dayLoad, teacherSeqs, dayCount, count };
  for (const s of slots) place(occ, s, seqOf);
  return occ;
}

type Occupancy = ReturnType<typeof occupancy>;

type Placed = Omit<SuggestInput["slots"][number], "roomId"> & { roomId?: string | null };

function place(occ: Occupancy, s: Placed, seqOf: Map<string, number>) {
  occ.busy.add(key("s", s.classSectionId, s.weekday, s.periodId));
  occ.busy.add(key("t", s.teacherId, s.weekday, s.periodId));
  if (s.roomId) occ.busy.add(key("r", s.roomId, s.weekday, s.periodId));
  bump(occ.load, s.teacherId);
  bump(occ.dayLoad, key(s.teacherId, s.weekday));
  const seq = seqOf.get(s.periodId);
  if (seq !== undefined) {
    const seqs = occ.teacherSeqs.get(key(s.teacherId, s.weekday)) ?? new Set<number>();
    seqs.add(seq);
    occ.teacherSeqs.set(key(s.teacherId, s.weekday), seqs);
  }
  bump(occ.dayCount, key(s.classSectionId, s.weekday, s.subjectId));
  bump(occ.count, key(s.classSectionId, s.subjectId));
}

/** Length of the teaching run through `seq` if the teacher also took it (adjacent seqs; a break has its own seq). */
export function runLength(seqs: Set<number>, seq: number): number {
  let n = 1;
  for (let s = seq - 1; seqs.has(s); s--) n++;
  for (let s = seq + 1; seqs.has(s); s++) n++;
  return n;
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

interface Ctx {
  rules: TimetableRules;
  occ: Occupancy;
  seqOf: Map<string, number>;
  labRooms: { id: string; name: string }[];
  section: { id: string; label: string };
  home: string | null;
}

const BAND_TEXT: Record<Band, string> = { before_lunch: "before lunch", after_lunch: "after lunch" };

/** First rule (in a fixed order) that rules this candidate out of the cell, or null when it fits. */
function check(c: Candidate, cell: { weekday: number; period: Period }, x: Ctx): Pick<Rejection, "rule" | "reason"> | null {
  const { rules, occ } = x;
  const { subjectName: subject, teacherName: teacher, teacherId, subjectId } = c.a;
  const sectionId = x.section.id;
  const day = WEEKDAY_SHORT[cell.weekday];
  const had = occ.count.get(key(sectionId, subjectId)) ?? 0;
  const load = occ.load.get(teacherId) ?? 0;
  const dayLoad = occ.dayLoad.get(key(teacherId, cell.weekday)) ?? 0;
  const todaySubject = occ.dayCount.get(key(sectionId, cell.weekday, subjectId)) ?? 0;

  if (c.target - had <= 0) return { rule: "target_met", reason: `${subject} already has its ${c.target} periods a week in ${x.section.label}` };
  if (occ.busy.has(key("t", teacherId, cell.weekday, cell.period.id)))
    return { rule: "teacher_busy", reason: `${teacher} already teaches another class then (double-booking is never allowed)` };
  if (rules.max_teacher_per_week.enabled && load >= rules.max_teacher_per_week.value)
    return { rule: "max_teacher_per_week", reason: `${teacher} already has ${load} periods a week (max ${rules.max_teacher_per_week.value})` };
  if (
    rules.teacher_unavailable.enabled &&
    rules.teacher_unavailable.value.some((u) => u.teacherId === teacherId && u.weekday === cell.weekday && (!u.periodId || u.periodId === cell.period.id))
  )
    return { rule: "teacher_unavailable", reason: `${teacher} is marked unavailable on ${day} ${cell.period.name}` };
  if (rules.max_teacher_per_day.enabled && dayLoad >= rules.max_teacher_per_day.value)
    return { rule: "max_teacher_per_day", reason: `${teacher} already has ${dayLoad} periods on ${day} (max ${rules.max_teacher_per_day.value})` };
  if (rules.max_consecutive_teacher.enabled) {
    const run = runLength(occ.teacherSeqs.get(key(teacherId, cell.weekday)) ?? new Set(), cell.period.seq);
    if (run > rules.max_consecutive_teacher.value)
      return { rule: "max_consecutive_teacher", reason: `${teacher} would teach ${run} periods in a row (max ${rules.max_consecutive_teacher.value})` };
  }
  if (rules.max_same_subject_per_day.enabled && todaySubject >= rules.max_same_subject_per_day.value)
    return {
      rule: "max_same_subject_per_day",
      reason: `${x.section.label} already has ${todaySubject} ${subject} on ${day} (max ${rules.max_same_subject_per_day.value})`,
    };
  if (rules.spread_across_week.enabled && todaySubject >= rules.spread_across_week.value) {
    const freeLater = WEEKDAYS.filter((d) => d > cell.weekday && !(occ.dayCount.get(key(sectionId, d, subjectId)) ?? 0)).length;
    if (freeLater >= c.target - had)
      return { rule: "spread_across_week", reason: `${subject} already has a period on ${day} and still fits on ${freeLater} later days` };
  }
  if (rules.subject_time_band.enabled && cell.period.band) {
    const want = rules.subject_time_band.value.find((b) => b.subjectId === subjectId)?.band;
    if (want && want !== cell.period.band) return { rule: "subject_time_band", reason: `${subject} is kept ${BAND_TEXT[want]}` };
  }
  if (rules.lab_rooms.enabled && rules.lab_rooms.value.includes(subjectId) && !freeLab(x, cell))
    return { rule: "lab_rooms", reason: `${subject} needs a lab and no lab is free on ${day} ${cell.period.name}` };
  return null;
}

function freeLab(x: Ctx, cell: { weekday: number; period: Period }): string | null {
  return x.labRooms.find((r) => !x.occ.busy.has(key("r", r.id, cell.weekday, cell.period.id)))?.id ?? null;
}

/** fill_v1 step 5: feasible candidate with the largest deficit, then the lower teacher load; plus every passed-over candidate and why. */
function pick(cands: Candidate[], cell: { weekday: number; period: Period }, x: Ctx) {
  let best: { c: Candidate; deficit: number; load: number } | null = null;
  const rejected: { c: Candidate; rule: Rejection["rule"]; reason: string }[] = [];
  const feasible: { c: Candidate; deficit: number }[] = [];
  for (const c of cands) {
    const why = check(c, cell, x);
    if (why) {
      rejected.push({ c, ...why });
      continue;
    }
    const deficit = c.target - (x.occ.count.get(key(x.section.id, c.a.subjectId)) ?? 0);
    const load = x.occ.load.get(c.a.teacherId) ?? 0;
    feasible.push({ c, deficit });
    // cands are in subject name/id order, so strict comparison keeps that tie-break.
    if (!best || deficit > best.deficit || (deficit === best.deficit && load < best.load)) best = { c, deficit, load };
  }
  if (!best) return null;
  const chosen = best;
  for (const f of feasible) {
    if (f.c === chosen.c) continue;
    rejected.push({
      c: f.c,
      rule: "ranked_lower",
      reason: `${f.c.a.subjectName} needs ${f.deficit} more a week; ${chosen.c.a.subjectName} needs ${chosen.deficit} (or ${chosen.c.a.teacherName} has fewer periods)`,
    });
  }
  const order = new Map(cands.map((c, i) => [c, i]));
  rejected.sort((p, q) => order.get(p.c)! - order.get(q.c)!);
  return { c: chosen.c, rejected };
}

/** Enabled rules a suggestion kept, with their current numbers for the rationale. */
function keptRules(c: Candidate, weekday: number, x: Ctx): { codes: RuleCode[]; text: string[] } {
  const { rules, occ } = x;
  const codes: RuleCode[] = [];
  const text: string[] = [];
  const { subjectName: subject, teacherName: teacher, teacherId, subjectId } = c.a;
  if (rules.max_same_subject_per_day.enabled) {
    codes.push("max_same_subject_per_day");
    text.push(`max ${rules.max_same_subject_per_day.value} ${subject} a day`);
  }
  if (rules.max_teacher_per_week.enabled) {
    codes.push("max_teacher_per_week");
    text.push(`${teacher} at ${(occ.load.get(teacherId) ?? 0) + 1} of ${rules.max_teacher_per_week.value} a week`);
  }
  if (rules.max_teacher_per_day.enabled) {
    codes.push("max_teacher_per_day");
    text.push(`${teacher} at ${(occ.dayLoad.get(key(teacherId, weekday)) ?? 0) + 1} of ${rules.max_teacher_per_day.value} that day`);
  }
  if (rules.max_consecutive_teacher.enabled) {
    codes.push("max_consecutive_teacher");
    text.push(`at most ${rules.max_consecutive_teacher.value} in a row`);
  }
  if (rules.teacher_unavailable.enabled && rules.teacher_unavailable.value.some((u) => u.teacherId === teacherId)) {
    codes.push("teacher_unavailable");
    text.push(`${teacher}'s unavailable times avoided`);
  }
  if (rules.spread_across_week.enabled) {
    codes.push("spread_across_week");
    text.push(`${subject} spread across the week`);
  }
  const band = rules.subject_time_band.enabled ? rules.subject_time_band.value.find((b) => b.subjectId === subjectId)?.band : undefined;
  if (band) {
    codes.push("subject_time_band");
    text.push(`${subject} ${BAND_TEXT[band]}`);
  }
  if (rules.lab_rooms.enabled && rules.lab_rooms.value.includes(subjectId)) {
    codes.push("lab_rooms");
    text.push(`${subject} in a lab`);
  }
  return { codes, text };
}

/** fill_v1 step 7 texts; `had` = the section's periods of the subject before this suggestion. */
function texts(section: string, period: Period, weekday: number, c: Candidate, had: number, room: string | null, kept: string[]) {
  const { subjectName: subject, teacherName: teacher } = c.a;
  const where = `${WEEKDAY_SHORT[weekday]} period ${period.seq} (${period.name})`;
  return {
    action: cut(`Add ${subject} to ${section}, ${where}, with ${teacher}${room ? ` in ${room}` : ""}`, ACTION_MAX),
    owner: OWNER,
    rationale: cut(
      `${teacher} is free in this period${room ? ` and ${room} is free` : ""}; ${subject} has ${had} of ${c.target} periods a week in ${section}.` +
        (kept.length ? ` Rules kept: ${kept.join("; ")}.` : ""),
      RATIONALE_MAX,
    ),
    expected_outcome: cut(`${section} ${subject}: ${had + 1} of ${c.target} periods a week.`, OUTCOME_MAX),
  };
}

/** An empty cell no candidate fits, with each candidate's reason (first BLOCKED_MAX cells). */
export interface BlockedCell {
  classSectionId: string;
  weekday: number;
  periodId: string;
  label: string;
  reasons: Rejection[];
}

const BLOCKED_MAX = 100;

export function suggestFill(input: SuggestInput): {
  suggestions: TimetableSuggestion[];
  unfilled: number;
  truncated: boolean;
  blocked: BlockedCell[];
} {
  const rules = input.rules ?? defaultRules(input.maxPeriodsWeek);
  const periods = [...input.periods].sort((a, b) => a.seq - b.seq || byId(a.id, b.id));
  const sections = [...input.sections].sort(
    (a, b) => a.label.localeCompare(b.label, "en", { numeric: true }) || byId(a.id, b.id),
  );
  const roomName = new Map(input.rooms.map((r) => [r.id, r.name]));
  const labRooms = input.rooms
    .filter((r) => r.kind === "lab")
    .sort((a, b) => a.name.localeCompare(b.name, "en") || byId(a.id, b.id));
  const seqOf = new Map(periods.map((p) => [p.id, p.seq]));
  const cellsPerWeek = WEEKDAYS.length * periods.length;
  const occ = occupancy(input.slots, seqOf);

  const suggestions: TimetableSuggestion[] = [];
  const blocked: BlockedCell[] = [];
  let empty = 0;
  let truncated = false;
  for (const section of sections) {
    const cands = candidates(section.id, input.assignments, cellsPerWeek);
    const x: Ctx = { rules, occ, seqOf, labRooms, section, home: homeRoom(section.id, input.slots, roomName) };
    for (const weekday of WEEKDAYS) {
      for (const period of periods) {
        if (occ.busy.has(key("s", section.id, weekday, period.id))) continue;
        empty++; // a suggestion fills only its own cell, so this counts the empty cells before the pass
        if (truncated) continue;
        const picked = pick(cands, { weekday, period }, x);
        if (!picked) {
          if (cands.length > 0 && blocked.length < BLOCKED_MAX)
            blocked.push({
              classSectionId: section.id,
              weekday,
              periodId: period.id,
              label: `${section.label} · ${WEEKDAY_SHORT[weekday]} · ${period.name}`,
              reasons: cands.map((c) => ({ subject: c.a.subjectName, teacher: c.a.teacherName, teacherId: c.a.teacherId, ...check(c, { weekday, period }, x)! })),
            });
          continue;
        }
        if (suggestions.length === input.limit) {
          truncated = true; // a further feasible suggestion exists past the limit
          continue;
        }

        const { c } = picked;
        const needsLab = rules.lab_rooms.enabled && rules.lab_rooms.value.includes(c.a.subjectId);
        const room = needsLab
          ? freeLab(x, { weekday, period })
          : x.home !== null && !occ.busy.has(key("r", x.home, weekday, period.id))
            ? x.home
            : null;
        const had = occ.count.get(key(section.id, c.a.subjectId)) ?? 0;
        const kept = keptRules(c, weekday, x);
        const slot = { classSectionId: section.id, weekday, periodId: period.id, subjectId: c.a.subjectId, teacherId: c.a.teacherId };
        suggestions.push({
          ...texts(section.label, period, weekday, c, had, room && roomName.get(room)!, kept.text),
          status: "planned",
          slot: room ? { ...slot, roomId: room } : slot,
          rules: ["fill_target", ...kept.codes],
          alternatives: picked.rejected.map((r) => ({
            subject: r.c.a.subjectName,
            teacher: r.c.a.teacherName,
            teacherId: r.c.a.teacherId,
            rule: r.rule,
            reason: r.reason,
          })),
        });
        place(occ, { ...slot, roomId: room }, seqOf);
      }
    }
  }
  return { suggestions, unfilled: empty - suggestions.length, truncated, blocked };
}

/** Label for a rule code or engine reason in the UI. */
export function ruleLabel(code: string): string {
  if (code === "fill_target") return "Weekly share";
  if (code === "teacher_busy") return "Double-booking (always blocked)";
  if (code === "target_met") return "Weekly share met";
  if (code === "ranked_lower") return "Ranked lower";
  return RULE_CATALOG[code as RuleCode]?.label ?? code;
}
