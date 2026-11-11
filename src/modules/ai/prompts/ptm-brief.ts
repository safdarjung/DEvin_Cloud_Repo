// features-18 §C #18 — parent-teacher meeting brief. PII allow-list by
// construction: grade label, attendance %, the latest published result by
// subject, pending assignment titles/counts and (only when the caller may
// see them) behaviour point sums. Never a name, admission number, date of
// birth, guardian, contact, incident note or health record.
import { dataBlock, DATA_IS_NOT_INSTRUCTIONS } from "./data-block";

export interface PtmBriefPromptInput {
  gradeLabel: string | null;
  attendancePct: number | null;
  latestExam: {
    name: string;
    percentage: number;
    grade: string;
    subjects: { name: string; marks: string; grade: string | null }[];
  } | null;
  pendingAssignments: { count: number; overdue: number; titles: string[] };
  behaviourPoints: { merit: number; demerit: number } | null;
}

export const PTM_BRIEF_INSTRUCTIONS =
  "You prepare a teacher for a parent-teacher meeting about one student. Return JSON with " +
  "`strengths` (1 to 3), `concerns` (0 to 3), `talkingPoints` (exactly 3) and `nextSteps` (exactly " +
  "2, practical things the parent and school can do) — each a short sentence of at most 200 " +
  "characters. Refer to the student only as \"the student\"; never invent a name. Use only facts in " +
  "the data; if something is missing, do not guess it. Be kind and specific. Plain text only. " +
  "Respond with JSON only, matching the schema. These are suggestions for the teacher. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildPtmBriefPrompt(input: PtmBriefPromptInput): string {
  const { latestExam, pendingAssignments: pending, behaviourPoints } = input;
  return dataBlock("Prepare a one-page meeting brief from this student's school record.", [
    `Grade: ${input.gradeLabel ?? "unknown"}`,
    `Attendance this term: ${input.attendancePct === null ? "no data" : `${input.attendancePct}%`}`,
    latestExam
      ? `Latest published exam: ${latestExam.name}, ${latestExam.percentage}% (grade ${latestExam.grade})`
      : "Latest published exam: none yet",
    ...(latestExam?.subjects ?? []).map((s) => `- ${s.name}: ${s.marks}${s.grade ? ` (grade ${s.grade})` : ""}`),
    `Pending assignments: ${pending.count} (${pending.overdue} overdue)`,
    ...pending.titles.map((t) => `- ${t}`),
    ...(behaviourPoints ? [`Behaviour points: merit ${behaviourPoints.merit}, demerit ${behaviourPoints.demerit}`] : []),
  ]);
}
