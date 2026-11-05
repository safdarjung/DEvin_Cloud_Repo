// M19-T10 rulings "fees": `finance.overdue_growth` and `finance.concession_spike`
// from the one-row `public.insight_src_fees` summary. Money is whole rupees.
// Relative `.ts` value imports: `pnpm jobs:run` loads this file.
import type { InsightSeverity } from "@/modules/fabric/types";
import { addDays, confidence, isoWeekKey, makeCandidate, pct, type Detector, type InsightCandidate } from "../signals.ts";

const VERSION = 1;
const OVERDUE_ACTIONS = [
  "Review the overdue invoice list and send fee reminders to families with the oldest balances.",
  "Check whether recent payment reversals need follow-up with the families concerned.",
];
const CONCESSION_ACTIONS = [
  "Review the recent concessions and confirm each one was approved under the school's fee policy.",
  "Check that every hardship or other concession has a recorded reason.",
];

/** The single row of `public.insight_src_fees`. */
export interface FeesSourceRow {
  overdue_now: number;
  overdue_then: number;
  overdue_count_now: number;
  overdue_count_then: number;
  concessions_recent: number;
  concessions_base: number;
  concessions_flagged: number;
}

const inr = (rupees: number) => `₹${rupees.toLocaleString("en-IN")}`;

function overdueGrowth(r: FeesSourceRow, asOf: string): InsightCandidate | null {
  const growth = r.overdue_now - r.overdue_then;
  const growthPct = r.overdue_then === 0 ? 100 : (100 * growth) / r.overdue_then;
  if (growth < 25000 || growthPct < 25) return null;
  const severity: InsightSeverity = growthPct >= 100 ? "critical" : growthPct >= 50 ? "warning" : "watch";
  const shownPct = pct(growth, r.overdue_then) ?? 100;
  return makeCandidate("finance.overdue_growth", VERSION, {
    severity,
    title: "Overdue fees rising",
    pattern: `Overdue fee balances grew from ${inr(r.overdue_then)} to ${inr(r.overdue_now)} (+${shownPct}%) in the 4 weeks to ${asOf}, across ${r.overdue_count_now} overdue invoices.`,
    evidence: [
      { label: "Overdue now", value: r.overdue_now, unit: "₹" },
      { label: "Overdue 4 weeks ago", value: r.overdue_then, unit: "₹" },
      { label: "Growth", value: shownPct, unit: "%" },
      { label: "Overdue invoices", value: r.overdue_count_now },
    ],
    sources: ["invoices", "payments", "payment_reversals"],
    date_from: addDays(asOf, -28),
    date_to: asOf,
    confidence: confidence((r.overdue_count_now >= 10 ? 0.7 : 0.5) + (growthPct >= 50 ? 0.15 : 0)),
    recommended_actions: OVERDUE_ACTIONS,
    entity_type: null,
    entity_id: null,
    entity_label: null,
    class_section_id: null,
    window: isoWeekKey(asOf),
  });
}

function concessionSpike(r: FeesSourceRow, asOf: string): InsightCandidate | null {
  const recent = r.concessions_recent;
  const base3 = Math.max(3, r.concessions_base); // 3·base28 with base28 = max(1, base/3); integer math
  if (recent < 5 || 3 * recent < 2 * base3) return null; // recent >= 2·base28
  const severity: InsightSeverity = recent >= base3 ? "warning" : "watch"; // recent >= 3·base28
  const usual = Math.round((base3 / 3) * 10) / 10;
  return makeCandidate("finance.concession_spike", VERSION, {
    severity,
    title: "Unusual number of fee concessions",
    pattern: `${recent} fee concessions were granted in the 4 weeks to ${asOf}, against a usual ${usual} per 4 weeks; ${r.concessions_flagged} were hardship or other.`,
    evidence: [
      { label: "Concessions (4 weeks)", value: recent },
      { label: "Usual per 4 weeks", value: usual },
      { label: "Hardship/other", value: r.concessions_flagged },
    ],
    sources: ["concessions"],
    date_from: addDays(asOf, -111),
    date_to: asOf,
    confidence: confidence(0.6 + (2 * r.concessions_flagged >= recent ? 0.1 : 0)),
    recommended_actions: CONCESSION_ACTIONS,
    entity_type: null,
    entity_id: null,
    entity_label: null,
    class_section_id: null,
    window: isoWeekKey(asOf),
  });
}

export function detectFees(row: FeesSourceRow | null, asOf: string): InsightCandidate[] {
  if (!row) return [];
  return [overdueGrowth(row, asOf), concessionSpike(row, asOf)].filter((c): c is InsightCandidate => c !== null);
}

export const feesDetector: Detector = {
  key: "fees",
  module: "fees",
  version: VERSION,
  async run(admin, { institutionId, asOf }) {
    // One-row source: far below max_rows, so no `.range()` paging.
    const { data, error } = await admin.rpc("insight_src_fees", { p_institution_id: institutionId, p_as_of: asOf });
    if (error) throw error;
    return detectFees(data?.[0] ?? null, asOf);
  },
};
