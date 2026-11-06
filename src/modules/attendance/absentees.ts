// Pure helpers for the dashboard's absence reads (no DB, unit-tested).

interface StatusLike {
  code: string;
  countsPresent: number;
  inDenominator: boolean;
}

/** Status codes that mean "not present" and are not "late" — the same split getSectionAttendancePatterns uses for absences. */
export function absentStatusCodes(statuses: StatusLike[]): string[] {
  return statuses.filter((s) => s.inDenominator && s.countsPresent < 1 && s.code.toLowerCase() !== "late").map((s) => s.code);
}

export interface RepeatedAbsentee {
  studentId: string;
  name: string;
  classSection: string;
  absences: number;
}

/** Count absences per student; keep those at/over `minAbsences`, most absences first. */
export function tallyRepeatedAbsentees(
  rows: { studentId: string; name: string; classSection: string }[],
  minAbsences: number,
  limit: number,
): RepeatedAbsentee[] {
  const byStudent = new Map<string, RepeatedAbsentee>();
  for (const r of rows) {
    const cur = byStudent.get(r.studentId);
    if (cur) cur.absences += 1;
    else byStudent.set(r.studentId, { ...r, absences: 1 });
  }
  return [...byStudent.values()]
    .filter((s) => s.absences >= minAbsences)
    .sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name))
    .slice(0, limit);
}
