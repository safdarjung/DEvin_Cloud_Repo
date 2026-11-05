// M19-T10 rulings "admissions": one school-level `admissions.stage_dwell` from
// `public.insight_src_admissions` (one row per open stage). Dwell is proxied by
// `updated_at` in SQL: there is no stage history (debt).
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { addDays, isoWeekKey, makeCandidate, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const ACTIONS = [
  "Assign an owner to each stalled enquiry and application and agree a follow-up date.",
  "Contact the longest-waiting families first and update each item's stage after the call.",
];

/** Days an item may wait in a stage before it counts as stale. */
export const ADMISSION_STAGE_THRESHOLDS = {
  "enquiry.new": 2,
  "enquiry.contacted": 7,
  "enquiry.visit_scheduled": 14,
  "enquiry.application_sent": 14,
  "application.submitted": 7,
  "application.under_review": 7,
  "application.interaction_scheduled": 14,
} as const;

type AdmissionStage = keyof typeof ADMISSION_STAGE_THRESHOLDS;

const STAGE_LABELS: Record<AdmissionStage, string> = {
  "enquiry.new": "New enquiries",
  "enquiry.contacted": "Contacted enquiries",
  "enquiry.visit_scheduled": "Visit-scheduled enquiries",
  "enquiry.application_sent": "Application-sent enquiries",
  "application.submitted": "Submitted applications",
  "application.under_review": "Applications under review",
  "application.interaction_scheduled": "Interaction-scheduled applications",
};

const LONGEST_WAIT = Math.max(...Object.values(ADMISSION_STAGE_THRESHOLDS));

/** One row of `public.insight_src_admissions`; only the stage's own `over_<t>` is non-zero. */
export interface AdmissionsSourceRow {
  stage: string;
  open_count: number;
  over_2: number;
  over_7: number;
  over_14: number;
}

export function detectAdmissions(rows: AdmissionsSourceRow[], asOf: string): InsightCandidate[] {
  const stages = rows.flatMap((r) => {
    if (!(r.stage in ADMISSION_STAGE_THRESHOLDS)) return [];
    const stage = r.stage as AdmissionStage;
    const days = ADMISSION_STAGE_THRESHOLDS[stage];
    return [{ stage, days, open: r.open_count, stale: r[`over_${days}`] }];
  });
  const open = stages.reduce((n, s) => n + s.open, 0);
  const stale = stages.reduce((n, s) => n + s.stale, 0);
  if (stale < 5 || 4 * stale < open) return []; // stale >= 0.25·open without float
  const staleNew = stages.find((s) => s.stage === "enquiry.new")?.stale ?? 0;
  const severity: InsightSeverity = stale >= 20 || staleNew >= 10 ? "warning" : "watch";
  const top = stages
    .filter((s) => s.stale > 0)
    .sort((a, b) => b.stale - a.stale || (a.stage < b.stage ? -1 : 1))
    .slice(0, 4);
  return [
    makeCandidate("admissions.stage_dwell", VERSION, {
      severity,
      title: "Admissions follow-ups are stalling",
      pattern: `${stale} of ${open} open enquiries and applications have waited past their stage's follow-up time as of ${asOf}.`,
      evidence: [
        ...top.map((s) => ({ label: `${STAGE_LABELS[s.stage]} waiting > ${s.days} days`, value: s.stale })),
        { label: "Open items", value: open },
      ],
      sources: ["enquiries", "applications"],
      date_from: addDays(asOf, -LONGEST_WAIT),
      date_to: asOf,
      confidence: 0.75,
      recommended_actions: ACTIONS,
      entity_type: null,
      entity_id: null,
      entity_label: null,
      class_section_id: null,
      window: isoWeekKey(asOf),
    }),
  ];
}

export const admissionsDetector: Detector = {
  key: "admissions",
  module: "admissions",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    // At most 7 rows (one per stage): far below max_rows, so no `.range()` paging.
    const { data, error } = await admin.rpc("insight_src_admissions", { p_institution_id: institutionId, p_as_of: asOf });
    if (error) throw error;
    return detectAdmissions(data ?? [], asOf);
  },
};
