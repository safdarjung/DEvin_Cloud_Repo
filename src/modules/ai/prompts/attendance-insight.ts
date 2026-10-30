import "server-only";
// New — attendance-pattern-insight prompt (04 §5 "AI gateway", 07 §5 "AI
// governance — Data flow", mirrors quiz.ts's own discipline comment).
//
// `buildAttendanceInsightPrompt` is typed to accept ONLY
// `AnonymizedAttendancePattern` — a position-based `index` plus plain
// numbers/booleans (see `modules/attendance/queries.ts`). There is no
// parameter through which a student's name, id, roll number, or any other
// identifier could ever reach this prompt. Widening the accepted type to
// carry one is the thing a reviewer should catch, not a redaction step
// bolted on afterward.
import type { AnonymizedAttendancePattern } from "@/modules/attendance/queries";

export const ATTENDANCE_INSIGHT_INSTRUCTIONS =
  "You help a teacher notice attendance patterns worth a look — this is informational only, " +
  "never a grade, a status change, or a disciplinary judgment. Each student is given only as " +
  "an opaque index (never a name) with present/absent/late counts for the term and which of " +
  "their last school days were days they were not fully present (0 = most recent school day). " +
  "Flag ONLY students with a genuinely unusual recent pattern — most students should not be " +
  "flagged at all. For each flagged student, return a short, neutral, factual note such as " +
  '"3 of the last 5 school days", under 150 characters, with no diagnosis, no blame, and no ' +
  "recommended action. Respond with JSON only, matching the schema exactly — no markdown " +
  "fences, no commentary.";

/** Builds the prompt from the anonymized array only — see the import note above. */
export function buildAttendanceInsightPrompt(patterns: readonly AnonymizedAttendancePattern[]): string {
  return [
    "Students (index, presentCount, absentCount, lateCount, recentAbsentDayOffsets):",
    JSON.stringify(patterns),
  ].join("\n");
}
