// F18 §H — "Set up for me": the fixed catalogue behind core.setup.applyTemplate.
// Builds the exact jsonb public.apply_school_template takes (shape and limits:
// supabase/migrations/20261028000127_school_setup.sql header); the SQL
// re-validates everything. Pure, no I/O: the action builds it server-side from
// validated choices and the setup page reuses it for the preview.
// Subjects reuse the seed catalogue; scripts/seed/lib/subjects.ts has no
// imports, so it is safe to bundle into app code.
import { subjectsFor, type SubjectDef } from "../../../../scripts/seed/lib/subjects.ts";

export const BOARDS = ["CBSE", "ICSE", "State"] as const;
export type Board = (typeof BOARDS)[number];

// Nursery..XII = 15 rungs, the SQL cap of 15 grades.
export const GRADE_LADDER = ["NUR", "LKG", "UKG", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;
export type GradeCode = (typeof GRADE_LADDER)[number];

export const MAX_SECTIONS_PER_GRADE = 8;
const SECTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const PRE_PRIMARY_NAMES: Partial<Record<GradeCode, string>> = { NUR: "Nursery", LKG: "LKG", UKG: "UKG" };

type GradeGroup = "primary" | "middle" | "secondary" | "senior_secondary";

export interface SchoolTemplateChoices {
  board: Board;
  fromGrade: GradeCode;
  toGrade: GradeCode;
  sectionsPerGrade: number;
  /** YYYY-MM-DD; the year runs 12 months from here, two 6-month terms. */
  yearStart: string;
}

interface DateRange {
  name: string;
  starts_on: string;
  ends_on: string;
}

export interface SchoolTemplate {
  academic_year: DateRange;
  terms: DateRange[];
  grades: { code: GradeCode; display_name: string; grade_group: GradeGroup; sections: string[]; subjects: SubjectDef[] }[];
  periods: { name: string; starts_at: string; ends_at: string; is_break?: boolean }[];
  fee_structure: { name: string; components: { head: string; frequency: string; amount_paise: number }[] };
}

const ICSE_SOCIAL: SubjectDef[] = [
  { code: "HCG", name: "History and Civics", kind: "scholastic" },
  { code: "GEO", name: "Geography", kind: "scholastic" },
];
const REGIONAL_LANGUAGE: SubjectDef = { code: "RL", name: "Regional Language", kind: "language" };

// 40-minute periods from 08:00 with a short break and lunch (10 rows, cap 12).
const PERIODS: SchoolTemplate["periods"] = [
  { name: "Period 1", starts_at: "08:00", ends_at: "08:40" },
  { name: "Period 2", starts_at: "08:40", ends_at: "09:20" },
  { name: "Period 3", starts_at: "09:20", ends_at: "10:00" },
  { name: "Short break", starts_at: "10:00", ends_at: "10:15", is_break: true },
  { name: "Period 4", starts_at: "10:15", ends_at: "10:55" },
  { name: "Period 5", starts_at: "10:55", ends_at: "11:35" },
  { name: "Lunch", starts_at: "11:35", ends_at: "12:05", is_break: true },
  { name: "Period 6", starts_at: "12:05", ends_at: "12:45" },
  { name: "Period 7", starts_at: "12:45", ends_at: "13:25" },
  { name: "Period 8", starts_at: "13:25", ends_at: "14:05" },
];

// Placeholder amounts (integer paise) the owner edits before assigning anything.
const PLACEHOLDER_FEES: SchoolTemplate["fee_structure"]["components"] = [
  { head: "tuition", frequency: "monthly", amount_paise: 250_000 },
  { head: "annual_charges", frequency: "annual", amount_paise: 500_000 },
  { head: "admission", frequency: "one_time", amount_paise: 1_000_000 },
  { head: "exam", frequency: "term", amount_paise: 50_000 },
];

function gradeGroup(rung: number): GradeGroup {
  if (rung <= GRADE_LADDER.indexOf("V")) return "primary";
  if (rung <= GRADE_LADDER.indexOf("VIII")) return "middle";
  if (rung <= GRADE_LADDER.indexOf("X")) return "secondary";
  return "senior_secondary";
}

function subjectsForGrade(board: Board, rung: number, sections: string[]): SubjectDef[] {
  // Senior secondary streams follow the section letter, so take the union.
  let list = sections.flatMap((section) => subjectsFor(gradeGroup(rung), section));
  if (rung < GRADE_LADDER.indexOf("I")) list = list.filter((s) => s.code !== "COMP");
  if (board === "ICSE") list = list.flatMap((s) => (s.code === "SST" ? ICSE_SOCIAL : [s]));
  if (board === "State") list = list.map((s) => (s.code === "SANS" ? REGIONAL_LANGUAGE : s));
  return list.filter((s, i) => list.findIndex((other) => other.code === s.code) === i);
}

/** 1 April of the current academic year — the same default create_institution (0064) uses. */
export function defaultYearStart(now = new Date()): string {
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${year}-04-01`;
}

const isoUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export function buildSchoolTemplate(choices: SchoolTemplateChoices): SchoolTemplate {
  const from = GRADE_LADDER.indexOf(choices.fromGrade);
  const to = GRADE_LADDER.indexOf(choices.toGrade);
  if (from < 0 || to < from) throw new RangeError("grade range is invalid");
  const n = choices.sectionsPerGrade;
  if (!Number.isInteger(n) || n < 1 || n > MAX_SECTIONS_PER_GRADE) {
    throw new RangeError(`sections per grade must be 1-${MAX_SECTIONS_PER_GRADE}`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choices.yearStart);
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : [NaN, NaN, NaN];
  if (!match || y < 2000 || y > 2098 || isoUtc(y, m, d) !== choices.yearStart) throw new RangeError("year start is not a valid date");

  const yearName = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const yearEnd = isoUtc(y, m + 12, d - 1);
  const sections = SECTION_LETTERS.slice(0, n);

  return {
    academic_year: { name: yearName, starts_on: choices.yearStart, ends_on: yearEnd },
    terms: [
      { name: "Term 1", starts_on: choices.yearStart, ends_on: isoUtc(y, m + 6, d - 1) },
      { name: "Term 2", starts_on: isoUtc(y, m + 6, d), ends_on: yearEnd },
    ],
    grades: GRADE_LADDER.slice(from, to + 1).map((code, i) => ({
      code,
      display_name: PRE_PRIMARY_NAMES[code] ?? `Grade ${code}`,
      grade_group: gradeGroup(from + i),
      sections,
      subjects: subjectsForGrade(choices.board, from + i, sections),
    })),
    periods: PERIODS,
    fee_structure: { name: `Standard fees ${yearName} (placeholder amounts, edit before use)`, components: PLACEHOLDER_FEES },
  };
}
