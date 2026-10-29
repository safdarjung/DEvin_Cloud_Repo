import { DEFAULT_INSTITUTION_SETTINGS } from "../../../src/modules/core/schemas.ts";
import { getSeedScale, SECTIONS_PER_GRADE } from "../config.ts";

// Shared grade ladder (05 §8: 12 grades I-XII) so people.ts and academics.ts
// agree on the same (grade, section) keys without academics.ts's grade rows
// existing yet when people.ts runs first.
export interface GradeDef {
  code: string;
  displayName: string;
  sortKey: number;
  gradeGroup: string;
}

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function gradeGroupFor(code: string): string {
  const groups = DEFAULT_INSTITUTION_SETTINGS.academic.grade_groups as Record<string, readonly string[]>;
  const found = Object.entries(groups).find(([, codes]) => codes.includes(code));
  return found?.[0] ?? "primary";
}

export const GRADES: GradeDef[] = ROMAN_NUMERALS.map((code, i) => ({
  code,
  displayName: `Grade ${code}`,
  sortKey: i + 1,
  gradeGroup: gradeGroupFor(code),
}));

// Demo-data contract sections (05 §8.1) that must exist even in small mode
// (2 sections/grade), on top of the base A, B — e.g. I-C has room for
// T-028's live enrolment. Append here, never branch in people.ts/academics.ts.
export const EXTRA_SMALL_SCALE_SECTIONS: Record<string, string[]> = {
  I: ["C"],
};

/** Section letters for the current SEED_SCALE + grade, e.g. ["A","B"] for most grades in small mode, ["A","B","C"] for Grade I. */
export function sectionNames(gradeCode: string): string[] {
  const all = DEFAULT_INSTITUTION_SETTINGS.academic.section_names;
  const scale = getSeedScale();
  const base = all.slice(0, SECTIONS_PER_GRADE[scale]);
  if (scale === "full") return base;
  return [...base, ...(EXTRA_SMALL_SCALE_SECTIONS[gradeCode] ?? [])];
}

export function sectionKey(gradeCode: string, sectionName: string): string {
  return `${gradeCode}-${sectionName}`;
}
