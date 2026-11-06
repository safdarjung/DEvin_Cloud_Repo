// M19-T9 rulings "submissions": `academics.missing_work` (student rows) and
// `academics.awaiting_review` (section rows) from one source call.
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { addDays, confidence, isoWeekKey, makeCandidate, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const PAGE_SIZE = 1000;
const MISSING_ACTIONS = [
  "Check in with the student about the missing assignments and agree catch-up dates.",
  "Let the guardian know which assignments are still outstanding.",
];
const AWAITING_ACTIONS = [
  "Ask the section's teachers to give feedback on the oldest submissions first.",
  "Set a regular weekly slot for marking and feedback in this section.",
];

/**
 * One row of `public.insight_src_submissions`. `level='student'` rows carry
 * student_id/due/missing; `level='section'` rows carry awaiting/oldest.
 * The other columns are null (generated types mark them non-null).
 */
export interface SubmissionsSourceRow {
  level: string;
  class_section_id: string;
  section_label: string;
  student_id: string | null;
  due_count: number | null;
  missing_count: number | null;
  awaiting_count: number | null;
  oldest_awaiting_days: number | null;
}

function missingWork(r: SubmissionsSourceRow, studentId: string, asOf: string): InsightCandidate | null {
  const missing = r.missing_count ?? 0;
  const due = r.due_count ?? 0;
  if (missing < 3 || 2 * missing < due) return null; // missing/due >= 0.5 without float
  const severity: InsightSeverity = missing >= 5 ? "warning" : "watch";
  return makeCandidate("academics.missing_work", VERSION, {
    severity,
    title: `Missing work: a student in ${r.section_label}`,
    pattern: `A student has not submitted ${missing} of ${due} assignments due in the 4 weeks to ${asOf}.`,
    evidence: [
      { label: "Missing (4 weeks)", value: missing },
      { label: "Due (4 weeks)", value: due },
    ],
    sources: ["assignments", "assignment_submissions"],
    date_from: addDays(asOf, -27),
    date_to: asOf,
    confidence: confidence(0.4 + 0.1 * Math.min(missing, 5)),
    recommended_actions: MISSING_ACTIONS,
    entity_type: "student",
    entity_id: studentId,
    entity_label: null,
    class_section_id: r.class_section_id,
    window: isoWeekKey(asOf),
  });
}

function awaitingReview(r: SubmissionsSourceRow, asOf: string): InsightCandidate {
  const awaiting = r.awaiting_count ?? 0;
  const oldest = r.oldest_awaiting_days ?? 0;
  const severity: InsightSeverity = awaiting >= 15 || oldest >= 14 ? "warning" : "watch";
  return makeCandidate("academics.awaiting_review", VERSION, {
    severity,
    title: `Submissions awaiting feedback in ${r.section_label}`,
    pattern: `${awaiting} submissions in ${r.section_label} have waited 7+ days for feedback; the oldest has waited ${oldest} days.`,
    evidence: [
      { label: "Awaiting feedback", value: awaiting },
      { label: "Oldest (days)", value: oldest },
    ],
    sources: ["assignment_submissions"],
    date_from: addDays(asOf, -oldest),
    date_to: asOf,
    confidence: 0.9,
    recommended_actions: AWAITING_ACTIONS,
    entity_type: "section",
    entity_id: r.class_section_id,
    entity_label: r.section_label.slice(0, 60), // DB check: entity_label <= 60
    class_section_id: r.class_section_id,
    window: isoWeekKey(asOf),
  });
}

export function detectSubmissions(rows: SubmissionsSourceRow[], asOf: string): InsightCandidate[] {
  const out: InsightCandidate[] = [];
  for (const r of rows) {
    if (r.level === "section") out.push(awaitingReview(r, asOf));
    else if (r.level === "student" && r.student_id) {
      const c = missingWork(r, r.student_id, asOf);
      if (c) out.push(c);
    }
  }
  return out;
}

export const submissionsDetector: Detector = {
  key: "submissions",
  module: "assignments",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    const rows: SubmissionsSourceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .rpc("insight_src_submissions", { p_institution_id: institutionId, p_as_of: asOf })
        .order("level")
        .order("class_section_id")
        .order("student_id") // stable order, or pages can skip/repeat rows
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return detectSubmissions(rows, asOf);
  },
};
