// M19-T9 rulings "marks": `academics.marks_decline`, one candidate per student
// whose marks fell 15+ points in one or more subjects between the last two
// published exams. Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { addDays, confidence, makeCandidate, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const MIN_DROP_PTS = 15;
const PAGE_SIZE = 1000;
const SOURCES = ["marks", "exam_papers", "exams"];
const ACTIONS = [
  "Review the student's latest papers with the subject teachers to find where marks were lost.",
  "Agree a short support plan with the class teacher and share it with the guardian.",
];

/** One row of `public.insight_src_marks`: a (student, subject) that fell `p_min_drop_pts`+. */
export interface MarksSourceRow {
  student_id: string;
  class_section_id: string;
  section_label: string;
  subject_id: string;
  subject_name: string;
  prev_exam_id: string;
  prev_pct: number;
  last_exam_id: string;
  last_pct: number;
  last_published_on: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
// Both pcts arrive at 2 dp; rounding the difference keeps 75.3 - 45.3 at exactly 30.
const dropOf = (r: MarksSourceRow) => Math.round((r.prev_pct - r.last_pct) * 100) / 100;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function detectMarks(rows: MarksSourceRow[], asOf: string): InsightCandidate[] {
  const byStudent = new Map<string, MarksSourceRow[]>();
  for (const r of rows) {
    const group = byStudent.get(r.student_id);
    if (group) group.push(r);
    else byStudent.set(r.student_id, [r]);
  }

  return [...byStudent.entries()].map(([studentId, group]) => {
    const ranked = [...group].sort((a, b) => dropOf(b) - dropOf(a) || cmp(a.subject_name, b.subject_name));
    // Window row: latest last_published_on, tie → smallest exam id. Its section is the latest paper's.
    const latest = [...group].sort(
      (a, b) => cmp(b.last_published_on, a.last_published_on) || cmp(a.last_exam_id, b.last_exam_id),
    )[0];
    const n = group.length;
    const top = ranked[0];
    const worst = dropOf(top);
    const severity: InsightSeverity = worst >= 30 || n >= 3 ? "warning" : "watch";

    return makeCandidate("academics.marks_decline", VERSION, {
      severity,
      title: `Marks decline: a student in ${latest.section_label}`,
      pattern:
        `${n} ${n === 1 ? "subject" : "subjects"} fell ${MIN_DROP_PTS}+ points between the last two exams; ` +
        `largest: ${top.subject_name} ${round1(top.prev_pct)}% → ${round1(top.last_pct)}%.`,
      evidence: [
        ...ranked.slice(0, 3).flatMap((r) => [
          { label: `${r.subject_name} latest`, value: round1(r.last_pct), unit: "%" },
          { label: `${r.subject_name} change`, value: -round1(dropOf(r)), unit: "pts" },
        ]),
        { label: "Subjects declined", value: n },
      ],
      sources: SOURCES,
      date_from: addDays(asOf, -365),
      date_to: asOf,
      confidence: confidence(0.5 + 0.1 * Math.min(n, 3) + 0.01 * (worst - MIN_DROP_PTS)),
      recommended_actions: ACTIONS,
      entity_type: "student",
      entity_id: studentId,
      entity_label: null,
      class_section_id: latest.class_section_id,
      window: latest.last_exam_id,
    });
  });
}

export const marksDetector: Detector = {
  key: "marks",
  module: "exams",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    const rows: MarksSourceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .rpc("insight_src_marks", { p_institution_id: institutionId, p_as_of: asOf, p_min_drop_pts: MIN_DROP_PTS })
        .order("student_id")
        .order("subject_id") // stable order, or pages can skip/repeat rows
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return detectMarks(rows, asOf);
  },
};
