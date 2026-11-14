// Pure: teachers' qualification levels, the highest class each level may teach (the school's rule in
// settings.staff.max_grade_by_level, else the defaults below), and the class-by-class list the office
// uses to share classes out (0155).

export const QUAL_LEVELS = ["diploma", "bachelors", "masters", "doctorate"] as const;
export type QualLevel = (typeof QUAL_LEVELS)[number];

export const LEVEL_LABEL: Record<QualLevel, string> = {
  diploma: "Diploma (e.g. D.El.Ed.)",
  bachelors: "Bachelor's (e.g. B.A., B.Sc., B.Ed.)",
  masters: "Master's (e.g. M.A., M.Sc.)",
  doctorate: "Doctorate (Ph.D.)",
};
export const LEVEL_SHORT: Record<QualLevel, string> = { diploma: "Diploma", bachelors: "Bachelor's", masters: "Master's", doctorate: "Doctorate" };

/** Highest class per level when the school has set none: the common PRT (I-V), TGT (up to X) and PGT (XI-XII) pattern. */
export const DEFAULT_MAX_GRADE: Record<QualLevel, string> = { diploma: "V", bachelors: "X", masters: "XII", doctorate: "XII" };

export type QualRules = Partial<Record<QualLevel, string>>;

export interface QualGrade {
  id: string;
  code: string;
  sortKey: number;
}

export interface QualTeacher {
  staffId: string;
  name: string;
  level: QualLevel | null;
  /** Classes (grade ids) the teacher said they can teach; empty = did not say. */
  gradeIds: readonly string[];
  experienceYears: number | null;
}

const rank = (level: QualLevel | null) => (level === null ? -1 : QUAL_LEVELS.indexOf(level));

export function highestLevel(quals: readonly { level: QualLevel }[]): QualLevel | null {
  return quals.reduce<QualLevel | null>((best, q) => (rank(q.level) > rank(best) ? q.level : best), null);
}

/** Classes a level may teach: every class up to the rule's class. No qualification on file: none yet. A rule naming a class the school does not have: no limit. */
export function eligibleGrades<G extends QualGrade>(level: QualLevel | null, rules: QualRules, grades: readonly G[]): G[] {
  if (level === null) return [];
  const cap = grades.find((g) => g.code === (rules[level] ?? DEFAULT_MAX_GRADE[level]));
  return grades.filter((g) => cap === undefined || g.sortKey <= cap.sortKey).sort((a, b) => a.sortKey - b.sortKey);
}

/** Highest qualification first, then more experience, then name; profiles not filled in last. */
export function sortTeachers<T extends QualTeacher>(teachers: readonly T[]): T[] {
  return [...teachers].sort((a, b) => rank(b.level) - rank(a.level) || (b.experienceYears ?? 0) - (a.experienceYears ?? 0) || a.name.localeCompare(b.name));
}

/** For each class: qualified teachers who asked for it, then qualified teachers who did not. */
export function classWise<T extends QualTeacher, G extends QualGrade>(teachers: readonly T[], grades: readonly G[], rules: QualRules): { grade: G; preferred: T[]; alsoQualified: T[] }[] {
  const sorted = sortTeachers(teachers);
  const allowed = new Map(sorted.map((t) => [t.staffId, new Set(eligibleGrades(t.level, rules, grades).map((g) => g.id))]));
  return [...grades]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((grade) => {
      const qualified = sorted.filter((t) => allowed.get(t.staffId)?.has(grade.id));
      return {
        grade,
        preferred: qualified.filter((t) => t.gradeIds.includes(grade.id)),
        alsoQualified: qualified.filter((t) => !t.gradeIds.includes(grade.id)),
      };
    });
}
