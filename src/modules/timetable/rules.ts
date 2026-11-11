// Timetable rules (0141 timetable_rules.rules): what the suggestion engine,
// the publish checklist and the substitute picker obey. Pure, seed-script
// safe (relative .ts imports). Defaults reproduce the pre-0141 behaviour:
// max 2 of a subject a day, the weekly teacher cap, nothing else.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

const toggle = <T extends z.ZodTypeAny>(value: T) => z.object({ enabled: z.boolean(), value }).strict();
const count = (min: number, max: number) => z.number().int().min(min).max(max);

export const RULE_SCHEMAS = {
  max_same_subject_per_day: toggle(count(1, 8)),
  max_consecutive_teacher: toggle(count(1, 10)),
  max_teacher_per_day: toggle(count(1, 12)),
  max_teacher_per_week: toggle(count(1, 72)),
  subject_time_band: toggle(
    z.array(z.object({ subjectId: uuid, band: z.enum(["before_lunch", "after_lunch"]) }).strict()).max(50),
  ),
  lab_rooms: toggle(z.array(uuid).max(50)),
  spread_across_week: toggle(count(1, 4)),
  teacher_unavailable: toggle(
    z
      .array(z.object({ teacherId: uuid, weekday: z.number().int().min(1).max(6), periodId: uuid.optional() }).strict())
      .max(200),
  ),
  substitute_ranking: toggle(
    z
      .object({ sameSubject: count(0, 10), sameGrade: count(0, 10), fewestToday: count(0, 10), notCovering: count(0, 10) })
      .strict(),
  ),
} as const;

export type RuleCode = keyof typeof RULE_SCHEMAS;
export const RULE_CODES = Object.keys(RULE_SCHEMAS) as RuleCode[];

export const TimetableRulesSchema = z.object(RULE_SCHEMAS).strict();
export type TimetableRules = z.infer<typeof TimetableRulesSchema>;

export const DEFAULT_MAX_PERIODS_WEEK = 36;

export function defaultRules(maxPeriodsWeek = DEFAULT_MAX_PERIODS_WEEK): TimetableRules {
  return {
    max_same_subject_per_day: { enabled: true, value: 2 },
    max_consecutive_teacher: { enabled: false, value: 4 },
    max_teacher_per_day: { enabled: false, value: 6 },
    max_teacher_per_week: { enabled: true, value: maxPeriodsWeek },
    subject_time_band: { enabled: false, value: [] },
    lab_rooms: { enabled: false, value: [] },
    spread_across_week: { enabled: false, value: 1 },
    teacher_unavailable: { enabled: true, value: [] },
    substitute_ranking: { enabled: false, value: { sameSubject: 4, sameGrade: 2, fewestToday: 1, notCovering: 3 } },
  };
}

/** Stored rules over the defaults, key by key: a missing or invalid key keeps its default (never throws). */
export function resolveRules(stored: unknown, maxPeriodsWeek = DEFAULT_MAX_PERIODS_WEEK): TimetableRules {
  const rules = defaultRules(maxPeriodsWeek);
  if (typeof stored !== "object" || stored === null) return rules;
  const out: Record<string, unknown> = { ...rules };
  for (const code of RULE_CODES) {
    const parsed = RULE_SCHEMAS[code].safeParse((stored as Record<string, unknown>)[code]);
    if (parsed.success) out[code] = parsed.data;
  }
  return out as TimetableRules;
}

/** Plain-language name, what it does, and what "value" means — shown on the rules page and in reasons. */
export const RULE_CATALOG: Record<RuleCode, { label: string; description: string; valueLabel: string }> = {
  max_same_subject_per_day: {
    label: "Same subject per day",
    description: "A class never gets more than this many periods of one subject in a day.",
    valueLabel: "Periods a day",
  },
  max_consecutive_teacher: {
    label: "Teacher back-to-back periods",
    description: "A teacher never teaches more than this many periods in a row without a free period or break.",
    valueLabel: "Periods in a row",
  },
  max_teacher_per_day: {
    label: "Teacher periods per day",
    description: "A teacher never teaches more than this many periods in one day.",
    valueLabel: "Periods a day",
  },
  max_teacher_per_week: {
    label: "Teacher periods per week",
    description: "A teacher never teaches more than this many periods in a week.",
    valueLabel: "Periods a week",
  },
  subject_time_band: {
    label: "Subject time of day",
    description: "Chosen subjects are only placed before lunch (or only after lunch).",
    valueLabel: "Subjects and bands",
  },
  lab_rooms: {
    label: "Lab subjects in labs",
    description: "Chosen subjects are only placed when a room of type 'lab' is free, and go in that lab.",
    valueLabel: "Subjects needing a lab",
  },
  spread_across_week: {
    label: "Spread a subject across the week",
    description: "A subject is not repeated on a day while later days of the week still have room for it.",
    valueLabel: "Periods a day before repeating",
  },
  teacher_unavailable: {
    label: "Teacher unavailable times",
    description: "A teacher is never placed on a day or period they are marked unavailable.",
    valueLabel: "Unavailable times",
  },
  substitute_ranking: {
    label: "Substitute ranking",
    description:
      "Orders free teachers when you pick a substitute. Off: fewest periods a week first. On: points for teaching the same subject, the same grade, having fewest periods that day, and not already covering.",
    valueLabel: "Points",
  },
};
