// M19-T8 attendance detector (rulings "Detectors: attendance"). Pure rules over
// `public.insight_src_attendance`; the SQL source owns windows and weights.
import {
  addDays,
  confidence,
  isoWeekKey,
  makeCandidate,
  pct,
  type Detector,
  type InsightCandidate,
} from "../signals.ts";

/** One row of `public.insight_src_attendance`; `student_id` is null on section rows. */
export interface AttendanceSourceRow {
  level: string;
  class_section_id: string;
  section_label: string;
  student_id: string | null;
  recent_days: number;
  base_days: number;
  recent_present: number;
  recent_denominator: number;
  base_present: number;
  base_denominator: number;
}

const VERSION = 1;
const PAGE_SIZE = 1000; // PostgREST's own max_rows
const STUDENT_MAX_RECENT_PCT = 75;
const SOURCES = ["attendance_sessions", "attendance_records"];

const SECTION_ACTIONS = [
  "Ask the class teacher what changed for this section and note any known causes.",
  "Check the recorded absence reasons and follow up with families where absences repeat.",
];
const STUDENT_ACTIONS = [
  "Ask the class teacher to check in with the student and their family.",
  "Review the recorded absence reasons and agree a follow-up plan with the family.",
];

const round1 = (x: number) => Math.round(x * 10) / 10;

export function detectAttendance(rows: AttendanceSourceRow[], asOf: string): InsightCandidate[] {
  const window = isoWeekKey(asOf);
  const dateFrom = addDays(asOf, -34);
  const out: InsightCandidate[] = [];

  for (const row of rows) {
    const recent = pct(row.recent_present, row.recent_denominator);
    const base = pct(row.base_present, row.base_denominator);
    if (recent === null || base === null) continue;
    const drop = round1(base - recent);
    const label = row.section_label;
    const evidence = [
      { label: "Last 7 days", value: recent, unit: "%" },
      { label: "Previous 4 weeks", value: base, unit: "%" },
      { label: "Drop", value: drop, unit: "pts" },
      { label: "School days (last 7)", value: row.recent_days },
    ];
    const common = { evidence, sources: SOURCES, date_from: dateFrom, date_to: asOf, class_section_id: row.class_section_id, window };

    if (row.level === "section") {
      if (row.recent_days < 3 || row.base_days < 10 || drop < 5 || recent >= 90) continue;
      out.push(
        makeCandidate("attendance.section_drop", VERSION, {
          ...common,
          severity: drop >= 15 ? "critical" : drop >= 10 ? "warning" : "watch",
          confidence: confidence(0.4 + 0.03 * drop + 0.05 * Math.min(row.recent_days, 6)),
          title: `Attendance drop in ${label}`,
          pattern: `Attendance in ${label} fell from ${base}% to ${recent}% in the 7 days to ${asOf}.`,
          recommended_actions: SECTION_ACTIONS,
          entity_type: "section",
          entity_id: row.class_section_id,
          entity_label: label.slice(0, 60), // DB check: entity_label <= 60
        }),
      );
    } else if (row.level === "student" && row.student_id) {
      if (row.recent_denominator < 3 || row.base_denominator < 8 || recent > 75 || drop < 20) continue;
      out.push(
        makeCandidate("attendance.student_drop", VERSION, {
          ...common,
          severity: recent <= 50 ? "warning" : "watch",
          confidence: confidence(0.35 + 0.01 * drop + 0.05 * Math.min(row.recent_denominator, 6)),
          title: `Attendance drop: a student in ${label}`,
          pattern: `A student's attendance fell from ${base}% to ${recent}% in the 7 days to ${asOf}.`,
          recommended_actions: STUDENT_ACTIONS,
          entity_type: "student",
          entity_id: row.student_id,
          entity_label: null, // names are never copied (one-owner rule)
        }),
      );
    }
  }
  return out;
}

export const attendanceDetector: Detector = {
  key: "attendance",
  module: "attendance",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    const rows: AttendanceSourceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .rpc("insight_src_attendance", {
          p_institution_id: institutionId,
          p_as_of: asOf,
          p_student_max_recent_pct: STUDENT_MAX_RECENT_PCT,
        })
        // stable order, or pages can skip/repeat rows
        .order("level")
        .order("class_section_id")
        .order("student_id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return detectAttendance(rows, asOf);
  },
};
