// M19-T11 rulings "workload": `staff.workload` from `public.insight_src_workload`
// (slot count per teacher in the published version covering as_of).
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { makeCandidate, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const PAGE_SIZE = 1000; // PostgREST's own max_rows
const DEFAULT_MAX_PERIODS_WEEK = 36; // M07 default, same as src/modules/timetable/queries.ts
const ACTIONS = [
  "Review this teacher's timetable and move some periods to colleagues with spare capacity.",
  "Check whether a substitute or part-time teacher can take some of these classes.",
];

/** One row of `public.insight_src_workload`. */
export interface WorkloadSourceRow {
  version_id: string;
  staff_id: string;
  periods_week: number;
}

/** `settings.timetable.max_periods_week` when it is a positive number, else 36 (M07 `maxPeriodsPerWeek`). */
function maxPeriodsFrom(settings: Record<string, unknown>): number {
  const timetable = settings.timetable;
  const raw = typeof timetable === "object" && timetable !== null ? (timetable as Record<string, unknown>).max_periods_week : undefined;
  return typeof raw === "number" && raw > 0 ? raw : DEFAULT_MAX_PERIODS_WEEK;
}

export function detectWorkload(rows: WorkloadSourceRow[], asOf: string, maxPeriods: number): InsightCandidate[] {
  const out: InsightCandidate[] = [];
  for (const r of rows) {
    if (r.periods_week <= maxPeriods) continue;
    const severity: InsightSeverity = r.periods_week >= maxPeriods + 4 ? "warning" : "watch";
    out.push(
      makeCandidate("staff.workload", VERSION, {
        severity,
        title: "Teacher timetable above the weekly limit",
        pattern: `A teacher has ${r.periods_week} periods a week in the published timetable, above the limit of ${maxPeriods}.`,
        evidence: [
          { label: "Periods per week", value: r.periods_week },
          { label: "Limit", value: maxPeriods },
        ],
        sources: ["timetable_slots"],
        date_from: asOf,
        date_to: asOf,
        confidence: 0.95,
        recommended_actions: ACTIONS,
        entity_type: "staff",
        entity_id: r.staff_id,
        entity_label: null, // person names are never copied
        class_section_id: null,
        window: r.version_id,
      }),
    );
  }
  return out;
}

export const workloadDetector: Detector = {
  key: "workload",
  module: "timetable",
  version: VERSION,
  async run(admin, { institutionId, asOf, settings }) {
    const rows: WorkloadSourceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .rpc("insight_src_workload", { p_institution_id: institutionId, p_as_of: asOf })
        .order("version_id")
        .order("staff_id") // stable order, or pages can skip/repeat rows
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return detectWorkload(rows, asOf, maxPeriodsFrom(settings));
  },
};
