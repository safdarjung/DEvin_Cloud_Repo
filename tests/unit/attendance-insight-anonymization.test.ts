// New — anonymization boundary test for the attendance-pattern-insight AI
// feature (07 §5 "AI governance — Data flow"). Confirms the function that
// builds the AI request body never carries a seeded student's name/phone:
// only numbers/booleans survive into `AnonymizedAttendancePattern`, and the
// prompt built from it is equally clean.
import { describe, expect, test } from "vitest";
import {
  buildAnonymizedAttendancePatterns,
  type AttendanceStudentPattern,
} from "@/modules/attendance/queries";
import { buildAttendanceInsightPrompt } from "@/modules/ai/prompts/attendance-insight";

// Fixture: fake enrolled-student records as `getSectionAttendancePatterns`
// would produce them (name populated), with phone-shaped strings mixed in
// to the names to make a leak easy to detect even if it were partial.
const FIXTURE: AttendanceStudentPattern[] = [
  {
    studentId: "11111111-1111-1111-1111-111111111111",
    name: "Aarav Sharma 9876543210",
    presentCount: 18,
    absentCount: 2,
    lateCount: 0,
    halfDayCount: 0,
    recentAbsentDayOffsets: [0, 2, 4],
  },
  {
    studentId: "22222222-2222-2222-2222-222222222222",
    name: "Diya Mehta +91-9988776655",
    presentCount: 20,
    absentCount: 0,
    lateCount: 1,
    halfDayCount: 0,
    recentAbsentDayOffsets: [],
  },
  {
    studentId: "33333333-3333-3333-3333-333333333333",
    name: "Kabir Iyer",
    presentCount: 15,
    absentCount: 5,
    lateCount: 2,
    halfDayCount: 0,
    recentAbsentDayOffsets: [1, 3],
  },
];

const FORBIDDEN_SUBSTRINGS = [
  "Aarav",
  "Sharma",
  "9876543210",
  "Diya",
  "Mehta",
  "9988776655",
  "Kabir",
  "Iyer",
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
];

describe("buildAnonymizedAttendancePatterns", () => {
  test("strips name and studentId, keeping only index and plain counts/booleans", () => {
    const anonymized = buildAnonymizedAttendancePatterns(FIXTURE);

    expect(anonymized).toEqual([
      { index: 0, presentCount: 18, absentCount: 2, lateCount: 0, recentAbsentDayOffsets: [0, 2, 4] },
      { index: 1, presentCount: 20, absentCount: 0, lateCount: 1, recentAbsentDayOffsets: [] },
      { index: 2, presentCount: 15, absentCount: 5, lateCount: 2, recentAbsentDayOffsets: [1, 3] },
    ]);

    for (const item of anonymized) {
      expect(Object.keys(item).sort()).toEqual(
        ["absentCount", "index", "lateCount", "presentCount", "recentAbsentDayOffsets"].sort(),
      );
    }
  });

  test("the serialized request body contains zero occurrences of any seeded name/phone/id", () => {
    const anonymized = buildAnonymizedAttendancePatterns(FIXTURE);
    const serialized = JSON.stringify(anonymized);

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("the built AI prompt also contains zero occurrences of any seeded name/phone/id", () => {
    const anonymized = buildAnonymizedAttendancePatterns(FIXTURE);
    const prompt = buildAttendanceInsightPrompt(anonymized);

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  test("index is a plain array position, not derived from studentId", () => {
    const anonymized = buildAnonymizedAttendancePatterns(FIXTURE);
    expect(anonymized.map((a) => a.index)).toEqual([0, 1, 2]);
  });
});
