// T-019 — TS mirror of app.grade_for (20261028000001_foundation.sql §4.1).
// Never used to compute a result's grade (results.grade is the frozen
// publish-time snapshot value, never recomputed on read — rule 3 below);
// this exists only so tests/unit/grade-for.test.ts can assert parity with
// the SQL function at its boundaries without a DB round-trip.
export interface GradingBand {
  min: number;
  max: number;
  grade: string;
  points: number;
  fail?: boolean;
}

// The institution's "default" grading scale seeded by tests/db/foundation.test.ts
// and documented in 05 §4.1 — exported so db tests can configure an
// institution's settings with the exact same bands before comparing against
// the real app.grade_for().
export const DEFAULT_GRADING_BANDS: readonly GradingBand[] = [
  { min: 91, max: 100, grade: "A1", points: 10 },
  { min: 81, max: 90, grade: "A2", points: 9 },
  { min: 71, max: 80, grade: "B1", points: 8 },
  { min: 61, max: 70, grade: "B2", points: 7 },
  { min: 51, max: 60, grade: "C1", points: 6 },
  { min: 41, max: 50, grade: "C2", points: 5 },
  { min: 33, max: 40, grade: "D", points: 4 },
  { min: 21, max: 32, grade: "E1", points: 0, fail: true },
  { min: 0, max: 20, grade: "E2", points: 0, fail: true },
];

/**
 * Bands are integer min/max, so a fractional percentage (e.g. 32.99)
 * belongs to the band whose integer max it is still below the next band's
 * min — same `< max + 1` exclusive upper bound as app.grade_for.
 */
export function gradeFor(bands: readonly GradingBand[], percentage: number): string {
  const band = bands.find((b) => percentage >= b.min && percentage < b.max + 1);
  if (!band) {
    throw new Error(`No grade band matches percentage ${percentage}`);
  }
  return band.grade;
}
