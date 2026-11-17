// features-18 §D — Analysis lab pure logic (no DB, no AI; importable from
// client components). Numbers are computed here or in SQL (0125), never by
// a model: Monte Carlo bands and goal seek run over the simulator's own
// runScenario, captions narrate rows deterministically, and the same
// captions are the fallback when an AI explanation fails its digit check.
import { runScenario, type BaselineFacts } from "@/modules/fabric/demo/simulator";
import { mulberry32 } from "@/modules/fabric/demo/prng";
import type { InsightSeverity, ScenarioAssumptions } from "@/modules/fabric/types";
import { formatINR } from "@/lib/format";

// ---------------------------------------------------------------- 0125 row shapes
// Generated types mark every column non-null; the functions null a metric
// when fewer than 5 students contribute (0125 header), so nulls are typed here.
export interface LabCorrelationRow {
  class_section_id: string;
  grade: string;
  section: string;
  subject_id: string;
  subject: string;
  n: number;
  pearson_r: number | null;
  avg_attendance_pct: number | null;
  avg_mark_pct: number | null;
}

export interface LabAnomalyRow {
  class_section_id: string;
  grade: string;
  section: string;
  students: number;
  attendance_pct: number | null;
  attendance_z: number | null;
  avg_mark_pct: number | null;
  mark_z: number | null;
  fee_overdue_rate: number | null;
  fee_overdue_z: number | null;
}

export interface LabFeeCohortRow {
  grade_id: string;
  grade: string;
  attendance_band: string;
  students: number;
  invoices: number;
  overdue_invoices: number;
  overdue_paise: number;
  avg_days_overdue: number | null;
}

export interface LabTrendRow {
  class_section_id: string;
  grade: string;
  section: string;
  students: number;
  recent_weeks: number;
  prior_weeks: number;
  recent_pct: number | null;
  prior_pct: number | null;
  delta_pct: number | null;
  weekly_sd: number | null;
  is_break: boolean;
}

/** Round for display and for the AI payload — captions and prompt use the same rounding. */
export function round(value: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

export function sectionLabel(row: { grade: string; section: string }): string {
  return `${row.grade}-${row.section}`;
}

// ---------------------------------------------------------------- captions
export function correlationCaption(row: LabCorrelationRow): string {
  const where = `${sectionLabel(row)}, n = ${row.n}`;
  if (row.pearson_r == null) return `${row.subject} (${where}): no measurable link — attendance or marks are the same for everyone.`;
  const r = round(row.pearson_r, 2);
  if (r >= 0.3) return `r = ${r}: students who attend more score higher in ${row.subject} (${where}).`;
  if (r <= -0.3) return `r = ${r}: in ${row.subject} (${where}), students who attend more score lower — worth a closer look.`;
  return `r = ${r}: little link between attendance and marks in ${row.subject} (${where}).`;
}

const ANOMALY_METRICS = [
  { z: "attendance_z", value: "attendance_pct", label: "attendance" },
  { z: "mark_z", value: "avg_mark_pct", label: "average mark" },
  { z: "fee_overdue_z", value: "fee_overdue_rate", label: "overdue-invoice rate" },
] as const;

/** The metric furthest from the school average, or null when every z is null. */
export function strongestAnomaly(row: LabAnomalyRow): { label: string; value: number | null; z: number } | null {
  let best: { label: string; value: number | null; z: number } | null = null;
  for (const m of ANOMALY_METRICS) {
    const z = row[m.z];
    if (z == null) continue;
    if (!best || Math.abs(z) > Math.abs(best.z)) best = { label: m.label, value: row[m.value], z };
  }
  return best;
}

export function anomalyCaption(row: LabAnomalyRow): string {
  const top = strongestAnomaly(row);
  if (!top || Math.abs(top.z) < 1) return `${sectionLabel(row)}: close to the school average on every measure.`;
  const value = top.value == null ? "" : ` ${round(top.value)}%`;
  return `${sectionLabel(row)}: ${top.label}${value} is ${round(Math.abs(top.z))} SD ${top.z < 0 ? "below" : "above"} the school average.`;
}

export const BAND_LABEL: Record<string, string> = {
  critical: "critical attendance",
  warning: "low attendance",
  ok: "good attendance",
  no_data: "no attendance yet",
};

export function feeCohortCaption(row: LabFeeCohortRow): string {
  const who = `${row.grade}, ${BAND_LABEL[row.attendance_band] ?? row.attendance_band} (${row.students} students)`;
  if (row.overdue_invoices === 0) return `${who}: no overdue invoices.`;
  const days = row.avg_days_overdue == null ? "" : `, ${round(row.avg_days_overdue)} days late on average`;
  return `${who}: ${row.overdue_invoices} of ${row.invoices} invoices overdue (${formatINR(Math.round(row.overdue_paise / 100) * 100)})${days}.`;
}

export function trendBreakCaption(row: LabTrendRow): string {
  const label = sectionLabel(row);
  if (row.recent_pct == null || row.prior_pct == null || row.delta_pct == null) return `${label}: not enough weeks to compare yet.`;
  const recent = round(row.recent_pct);
  const prior = round(row.prior_pct);
  if (row.is_break) {
    const sd = row.weekly_sd == null ? "" : `, more than twice the usual weekly swing of ${round(row.weekly_sd)}`;
    return `${label}: attendance fell from ${prior}% to ${recent}% in the last ${row.recent_weeks} weeks (${round(row.delta_pct)} points${sd}).`;
  }
  return `${label}: ${recent}% in the last ${row.recent_weeks} weeks vs ${prior}% before — within the usual range.`;
}

// ---------------------------------------------------------------- simulator: Monte Carlo + goal seek
export function monthlySurplusPaise(a: ScenarioAssumptions, facts: BaselineFacts): number {
  const r = runScenario(a, facts);
  return (r.revenue_paise[0] ?? 0) - (r.cost_paise[0] ?? 0);
}

export interface MonteCarloBand {
  months: string[];
  /** Cumulative surplus (revenue - cost) by month, integer paise. */
  p10: number[];
  p50: number[];
  p90: number[];
  runs: number;
}

const DEFAULT_RUNS = 500;

// Box–Muller standard normal from two uniforms (u1 shifted off 0 so log is finite).
function normal(next: () => number): number {
  const u1 = 1 - next();
  const u2 = next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.round(p * (sorted.length - 1))]!;
}

/**
 * Each run draws every month's revenue as runScenario's revenue × (1 + σ·z),
 * z ~ N(0,1); cost stays the model's (it is already an assumption). σ is the
 * caller's spread (fee forecast backtest error, else a stated default).
 * Returns the P10/P50/P90 of cumulative surplus per month across runs.
 */
export function monteCarloSurplus(
  a: ScenarioAssumptions,
  facts: BaselineFacts,
  opts: { sigmaPct: number; runs?: number; seed?: number },
): MonteCarloBand {
  const base = runScenario(a, facts);
  const runs = opts.runs ?? DEFAULT_RUNS;
  const next = mulberry32(opts.seed ?? 1);
  const sigma = opts.sigmaPct / 100;
  const byMonth: number[][] = base.months.map(() => []);
  for (let run = 0; run < runs; run++) {
    let cumulative = 0;
    for (let m = 0; m < base.months.length; m++) {
      const revenue = Math.round((base.revenue_paise[m] ?? 0) * (1 + sigma * normal(next)));
      cumulative += revenue - (base.cost_paise[m] ?? 0);
      byMonth[m]!.push(cumulative);
    }
  }
  const sorted = byMonth.map((values) => [...values].sort((x, y) => x - y));
  return {
    months: base.months,
    p10: sorted.map((s) => percentile(s, 0.1)),
    p50: sorted.map((s) => percentile(s, 0.5)),
    p90: sorted.map((s) => percentile(s, 0.9)),
    runs,
  };
}

// ScenarioAssumptionsSchema.fee_change_pct bounds (slider range).
const FEE_MIN = -10;
const FEE_MAX = 25;

export type GoalSeekResult =
  | { ok: true; feeChangePct: number }
  | { ok: false; reason: "above_range"; bestFeeChangePct: number; bestSurplusPaise: number };

/**
 * Smallest fee change (within the slider range) whose monthly surplus meets
 * `targetPaise`, by bisection. Surplus rises with fee change across the whole
 * range: d/df[(1+f/100)(97-|f|/5)] > 0 for -10 <= f <= 25 (runScenario's
 * collection-rate model), so one crossing at most.
 */
export function goalSeekFeeChange(a: ScenarioAssumptions, facts: BaselineFacts, targetPaise: number): GoalSeekResult {
  const surplus = (f: number): number => monthlySurplusPaise({ ...a, fee_change_pct: f }, facts);
  if (surplus(FEE_MIN) >= targetPaise) return { ok: true, feeChangePct: FEE_MIN };
  const best = surplus(FEE_MAX);
  if (best < targetPaise) return { ok: false, reason: "above_range", bestFeeChangePct: FEE_MAX, bestSurplusPaise: best };
  let lo = FEE_MIN;
  let hi = FEE_MAX;
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (surplus(mid) >= targetPaise) hi = mid;
    else lo = mid;
  }
  // Ceil (not round) to 2 dp so the reported change still meets the target.
  return { ok: true, feeChangePct: Math.ceil(hi * 100) / 100 };
}

// ---------------------------------------------------------------- twin: what needs attention
export interface AttentionItem {
  nodeId: string | null;
  label: string;
  severity: Extract<InsightSeverity, "critical" | "warning">;
  reason: string;
  score: number;
}

const MIN_ATTENTION_Z = 1.5;
const CRITICAL_Z = 2;

/**
 * Timetable conflicts (per node) and section anomalies (|z| >= 1.5) in one
 * list: critical first, then by score. Conflicts outrank anomalies of the
 * same severity (a hard clash blocks the timetable; a z-score is a prompt to look).
 */
export function rankAttention(
  nodes: { id: string; label: string }[],
  conflicts: Record<string, { count: number; severity: InsightSeverity }>,
  anomalies: LabAnomalyRow[],
): AttentionItem[] {
  const labelById = new Map(nodes.map((n) => [n.id, n.label]));
  const items: AttentionItem[] = [];
  for (const [id, c] of Object.entries(conflicts)) {
    items.push({
      nodeId: id,
      label: labelById.get(id) ?? id,
      severity: c.severity === "critical" ? "critical" : "warning",
      reason: `${c.count} timetable conflict${c.count === 1 ? "" : "s"}`,
      score: 10 + c.count,
    });
  }
  for (const row of anomalies) {
    const top = strongestAnomaly(row);
    if (!top || Math.abs(top.z) < MIN_ATTENTION_Z) continue;
    // Above-average attendance/marks is good news; only a high overdue-invoice rate is adverse above the mean.
    const adverse = top.label === "overdue-invoice rate" ? top.z > 0 : top.z < 0;
    if (!adverse) continue;
    const nodeId = labelById.has(row.class_section_id) ? row.class_section_id : null;
    items.push({
      nodeId,
      label: nodeId ? labelById.get(nodeId)! : sectionLabel(row),
      severity: Math.abs(top.z) >= CRITICAL_Z ? "critical" : "warning",
      reason: anomalyCaption(row).replace(`${sectionLabel(row)}: `, ""),
      score: Math.abs(top.z),
    });
  }
  return items.sort((x, y) => (x.severity === y.severity ? y.score - x.score : x.severity === "critical" ? -1 : 1));
}
