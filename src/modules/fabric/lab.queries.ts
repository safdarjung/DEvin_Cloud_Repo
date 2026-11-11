import "server-only";
// features-18 §D — Analysis lab reads. Typed wrappers over the four 0125
// functions (security invoker: the caller's RLS applies to every table they
// read), each gated by requireLabAccess. labExplainData re-reads the numbers an
// AI explanation narrates — never trusted from the client — and shapes them
// into name-free aggregates (section/subject/grade labels, counts, %, z).
import { createClient } from "@/lib/supabase/server";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { listForecasts } from "@/modules/forecasts/queries";
import { realBaselineFacts, runScenario } from "@/modules/fabric/simulator.queries";
import {
  anomalyCaption,
  correlationCaption,
  feeCohortCaption,
  round,
  sectionLabel,
  strongestAnomaly,
  trendBreakCaption,
  type LabAnomalyRow,
  type LabCorrelationRow,
  type LabFeeCohortRow,
  type LabTrendRow,
} from "@/modules/fabric/lab";
import type { LabExplainRequest } from "@/modules/fabric/lab.schemas";

type LabFunction = "lab_attendance_marks_correlation" | "lab_section_anomalies" | "lab_fee_risk_cohorts" | "lab_trend_breaks";

/** School-wide analysis: insight.read plus insight.review (teacher holds read for its own sections only — z-scores over a partial view would mislead). */
export function requireLabAccess(ctx: TenantContext): void {
  requirePermission(ctx, "insight.read");
  requirePermission(ctx, "insight.review");
}

async function callLab<T>(ctx: TenantContext, fn: LabFunction): Promise<T[]> {
  requireLabAccess(ctx);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_institution_id: ctx.institution.id });
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

export const labCorrelation = (ctx: TenantContext): Promise<LabCorrelationRow[]> => callLab(ctx, "lab_attendance_marks_correlation");
export const labSectionAnomalies = (ctx: TenantContext): Promise<LabAnomalyRow[]> => callLab(ctx, "lab_section_anomalies");
export const labFeeRiskCohorts = (ctx: TenantContext): Promise<LabFeeCohortRow[]> => callLab(ctx, "lab_fee_risk_cohorts");
export const labTrendBreaks = (ctx: TenantContext): Promise<LabTrendRow[]> => callLab(ctx, "lab_trend_breaks");

// Used when no fee forecast backtest is visible (none run yet, or no forecast.read).
export const DEFAULT_SPREAD_PCT = 5;

/**
 * Monte Carlo spread for the simulator: mean backtested MAPE of the
 * school-wide fee-collection forecasts (forecasts.list), as a percent.
 * MAPE is a mean absolute error, used here as σ — a stated approximation.
 */
export async function feeForecastSpread(ctx: TenantContext): Promise<{ sigmaPct: number; fromBacktest: boolean }> {
  if (!hasPermission(ctx, "forecast.read")) return { sigmaPct: DEFAULT_SPREAD_PCT, fromBacktest: false };
  const rows = (await listForecasts(ctx, { kind: "fee_collections_term" })).filter((r) => r.classSectionId === null && r.nTrain > 0);
  if (rows.length === 0) return { sigmaPct: DEFAULT_SPREAD_PCT, fromBacktest: false };
  const mape = rows.reduce((sum, r) => sum + r.mape, 0) / rows.length;
  return { sigmaPct: Math.min(50, Math.max(1, round(mape * 100))), fromBacktest: true };
}

const MAX_ITEMS = 8;
const MAX_FALLBACK = 5;

const z1 = (v: number | null): number | null => (v == null ? null : round(v));

function anomalyItem(r: LabAnomalyRow) {
  return {
    group: sectionLabel(r),
    students: r.students,
    attendance_pct: z1(r.attendance_pct),
    attendance_z: z1(r.attendance_z),
    avg_mark_pct: z1(r.avg_mark_pct),
    mark_z: z1(r.mark_z),
    fee_overdue_rate_pct: z1(r.fee_overdue_rate),
    fee_overdue_z: z1(r.fee_overdue_z),
  };
}

function trendItem(r: LabTrendRow) {
  return {
    group: sectionLabel(r),
    students: r.students,
    recent_weeks: r.recent_weeks,
    prior_weeks: r.prior_weeks,
    recent_pct: z1(r.recent_pct),
    prior_pct: z1(r.prior_pct),
    delta_pct: z1(r.delta_pct),
    weekly_sd: z1(r.weekly_sd),
    is_break: r.is_break,
  };
}

const byMaxAbsZ = (a: LabAnomalyRow, b: LabAnomalyRow): number =>
  Math.abs(strongestAnomaly(b)?.z ?? 0) - Math.abs(strongestAnomaly(a)?.z ?? 0);

export interface LabExplainData {
  /** Name-free aggregates sent to the model; an empty array means nothing to explain. */
  data: unknown;
  /** Deterministic captions over the same rows — the fallback explanation. */
  fallback: string[];
}

/** Re-reads the numbers for one explain request under the caller's permissions. null = section not found / not visible. */
export async function labExplainData(ctx: TenantContext, req: LabExplainRequest): Promise<LabExplainData | null> {
  switch (req.kind) {
    case "correlation": {
      const rows = (await labCorrelation(ctx))
        .filter((r) => r.pearson_r != null)
        .sort((a, b) => Math.abs(b.pearson_r!) - Math.abs(a.pearson_r!))
        .slice(0, MAX_ITEMS);
      return {
        data: rows.map((r) => ({
          group: sectionLabel(r),
          subject: r.subject,
          n: r.n,
          r: round(r.pearson_r!, 2),
          avg_attendance_pct: z1(r.avg_attendance_pct),
          avg_mark_pct: z1(r.avg_mark_pct),
        })),
        fallback: rows.slice(0, MAX_FALLBACK).map(correlationCaption),
      };
    }
    case "anomalies": {
      const rows = (await labSectionAnomalies(ctx)).sort(byMaxAbsZ).slice(0, MAX_ITEMS);
      return { data: rows.map(anomalyItem), fallback: rows.slice(0, MAX_FALLBACK).map(anomalyCaption) };
    }
    case "fee_risk": {
      const rows = (await labFeeRiskCohorts(ctx)).slice(0, 20);
      return {
        data: rows.map((r) => ({
          grade: r.grade,
          attendance_band: r.attendance_band,
          students: r.students,
          invoices: r.invoices,
          overdue_invoices: r.overdue_invoices,
          overdue_rupees: Math.round(r.overdue_paise / 100),
          avg_days_overdue: z1(r.avg_days_overdue),
        })),
        fallback: [...rows].sort((a, b) => b.overdue_paise - a.overdue_paise).slice(0, MAX_FALLBACK).map(feeCohortCaption),
      };
    }
    case "trend_breaks": {
      const rows = (await labTrendBreaks(ctx)).slice(0, MAX_ITEMS);
      return { data: rows.map(trendItem), fallback: rows.slice(0, MAX_FALLBACK).map(trendBreakCaption) };
    }
    case "section": {
      const [anomalies, trends] = await Promise.all([labSectionAnomalies(ctx), labTrendBreaks(ctx)]);
      const anomaly = anomalies.find((r) => r.class_section_id === req.ref);
      const trend = trends.find((r) => r.class_section_id === req.ref);
      if (!anomaly && !trend) return null;
      return {
        data: [{ vs_school_average: anomaly ? anomalyItem(anomaly) : null, attendance_trend: trend ? trendItem(trend) : null }],
        fallback: [...(anomaly ? [anomalyCaption(anomaly)] : []), ...(trend ? [trendBreakCaption(trend)] : [])],
      };
    }
    case "scenario": {
      requirePermission(ctx, "scenario.manage");
      const baseline = await realBaselineFacts(ctx);
      if (!baseline) return null;
      const { facts } = baseline;
      const baselineAssumptions = { ...req.ref, enrolment_delta_pct: 0, staff_delta: 0, fee_change_pct: 0, cost_change_pct: 0 };
      const s = runScenario(req.ref, facts);
      const b = runScenario(baselineAssumptions, facts);
      const margin = (r: typeof s): number =>
        r.revenue_paise[0] ? round((((r.revenue_paise[0] ?? 0) - (r.cost_paise[0] ?? 0)) / r.revenue_paise[0]) * 100) : 0;
      const revenue = Math.round((s.revenue_paise[0] ?? 0) / 100);
      const cost = Math.round((s.cost_paise[0] ?? 0) / 100);
      const data = {
        assumptions: req.ref,
        monthly_revenue_rupees: revenue,
        monthly_cost_rupees: cost,
        baseline_monthly_revenue_rupees: Math.round((b.revenue_paise[0] ?? 0) / 100),
        margin_pct: margin(s),
        baseline_margin_pct: margin(b),
        capacity_utilisation_pct: s.capacity_utilisation_pct[0] ?? 0,
        teacher_load_hours_week: s.teacher_load_hours[0] ?? 0,
        risk_flags: s.risk_flags,
        cost_is_assumption: true,
      };
      return {
        data,
        fallback: [
          `Monthly revenue ₹${revenue} against cost ₹${cost}: margin ${data.margin_pct}% (baseline ${data.baseline_margin_pct}%).`,
          `Room capacity used: ${data.capacity_utilisation_pct}%; teacher load ${data.teacher_load_hours_week} hours a week.`,
          ...(s.risk_flags.length > 0 ? [`Risk flags: ${s.risk_flags.join(", ").replace(/_/g, " ")}.`] : []),
        ],
      };
    }
  }
}
