"use client";
// F-UI-08 results panel: Recharts line chart (baseline dashed, scenario
// solid) + confidence band, KPI strip with deltas, risk flag chips,
// sensitivity table. `scenario`/`baseline` are both plain runScenario()
// output — pure, client-computed, no server round-trip per slider move.
// Optional real overlays: forecasts' fee-collection line, timetable load.
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { AnimatedNumber } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { inr } from "@/lib/format";
import type { ScenarioResults } from "@/modules/fabric/types";
import type { SensitivityRow } from "@/modules/fabric/demo/simulator";

const RISK_LABELS: Record<string, string> = {
  capacity_utilisation_over_95pct: "Room capacity over 95%",
  teacher_load_over_28h: "Teacher load over 28h",
  margin_under_5pct: "Margin under 5%",
};

export const PARAM_LABELS: Record<string, string> = {
  enrolment_delta_pct: "Enrolment change",
  staff_delta: "Staff change",
  fee_change_pct: "Fee change",
  cost_change_pct: "Cost change",
  periods_per_day: "Periods per day",
  horizon_months: "Horizon",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function Delta({ current, base, invert = false }: { current: number; base: number; invert?: boolean }) {
  const diff = current - base;
  if (Math.abs(diff) < 0.01) return <span className="text-xs text-muted-foreground">no change</span>;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${good ? "text-emerald-600" : "text-destructive"}`}>
      {diff > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {Math.abs(diff).toFixed(1)}
    </span>
  );
}

export function ResultsPanel({
  scenario,
  baseline,
  sensitivity,
  forecastByMonth = {},
  teacherLoad = null,
}: {
  scenario: ScenarioResults;
  baseline: ScenarioResults;
  sensitivity: SensitivityRow[];
  /** "YYYY-MM" -> forecast fee collections, rupees/month (forecasts.financeSeries, term spread evenly). */
  forecastByMonth?: Record<string, number>;
  /** Real mean periods/week from the published timetable; replaces the modelled teacher-load figure when present. */
  teacherLoad?: { avgPeriodsWeek: number; maxPeriods: number } | null;
}) {
  const revenueRupees = scenario.revenue_paise.map((p) => p / 100);
  const costRupees = scenario.cost_paise.map((p) => p / 100);
  const baselineRevenueRupees = baseline.revenue_paise.map((p) => p / 100);

  const chartData = scenario.months.map((ym, i) => ({
    label: monthLabel(ym),
    revenue: revenueRupees[i] ?? 0,
    cost: costRupees[i] ?? 0,
    baselineRevenue: baselineRevenueRupees[i] ?? 0,
    forecast: forecastByMonth[ym] ?? null,
    // shortcut: the model gives one confidence_low/high_pct for the whole
    // horizon (widens with it), not a per-month series — applied uniformly
    // to every month rather than interpolated; upgrade if runScenario ever
    // returns a per-month band.
    bandLow: ((revenueRupees[i] ?? 0) * scenario.confidence_low_pct) / 100,
    bandHigh: ((revenueRupees[i] ?? 0) * scenario.confidence_high_pct) / 100,
  }));

  const horizonRevenue = sum(revenueRupees);
  const horizonCost = sum(costRupees);
  const baselineHorizonRevenue = sum(baselineRevenueRupees);
  const baselineHorizonCost = sum(baseline.cost_paise.map((p) => p / 100));
  const marginPct = horizonRevenue > 0 ? ((horizonRevenue - horizonCost) / horizonRevenue) * 100 : -100;
  const baselineMarginPct =
    baselineHorizonRevenue > 0 ? ((baselineHorizonRevenue - baselineHorizonCost) / baselineHorizonRevenue) * 100 : -100;
  const peakUtilisation = Math.max(...scenario.capacity_utilisation_pct, 0);
  const baselinePeakUtilisation = Math.max(...baseline.capacity_utilisation_pct, 0);
  const hasForecast = chartData.some((d) => d.forecast != null);
  const modelledLoad = scenario.teacher_load_hours[0] ?? 0;
  const modelledBaselineLoad = baseline.teacher_load_hours[0] ?? 0;
  // Real timetable load, moved by the model's scenario/baseline ratio (staff + enrolment deltas).
  const teacherLoadValue = teacherLoad
    ? Math.round(teacherLoad.avgPeriodsWeek * (modelledBaselineLoad > 0 ? modelledLoad / modelledBaselineLoad : 1) * 10) / 10
    : modelledLoad;
  const baselineTeacherLoad = teacherLoad ? teacherLoad.avgPeriodsWeek : modelledBaselineLoad;

  return (
    <div className="space-y-6">
      <ChartFrame
        summary={`Revenue ${inr(horizonRevenue)} vs cost ${inr(horizonCost)} over ${scenario.months.length} months, scenario vs baseline${hasForecast ? ", with the fee-collection forecast" : ""}.`}
        heightClass="h-64 sm:h-80"
      >
        <ComposedChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} {...chartGrid} />
          <XAxis dataKey="label" {...chartAxis} />
          <YAxis tickFormatter={formatINRCompact} width={64} {...chartAxis} />
          <Tooltip formatter={(v) => inr(Number(v))} {...chartTooltip} />
          <Legend />
          <Area
            isAnimationActive animationDuration={300}
            dataKey="bandHigh"
            name="Confidence band"
            stroke="none"
            fill="var(--chart-1)"
            fillOpacity={0.12}
          />
          <Area isAnimationActive animationDuration={300} dataKey="bandLow" stroke="none" fill="var(--background)" fillOpacity={1} legendType="none" />
          <Line
            isAnimationActive animationDuration={300}
            dataKey="baselineRevenue"
            name="Baseline revenue"
            stroke="var(--muted-foreground)"
            strokeDasharray="6 4"
            dot={false}
          />
          <Line isAnimationActive animationDuration={300} dataKey="revenue" name="Scenario revenue" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
          <Line isAnimationActive animationDuration={300} dataKey="cost" name="Scenario cost" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} />
          {hasForecast && (
            <Line
              isAnimationActive animationDuration={300}
              dataKey="forecast"
              name="Forecast (fee collections)"
              stroke="var(--chart-3)"
              strokeDasharray="2 3"
              strokeWidth={2}
              dot={false}
            />
          )}
        </ComposedChart>
      </ChartFrame>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{scenario.months.length}-month revenue</p>
          <p className="text-lg font-semibold tabular-nums break-words"><AnimatedNumber value={horizonRevenue} format="inr" /></p>
          <Delta current={horizonRevenue} base={baselineHorizonRevenue} />
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{scenario.months.length}-month cost</p>
          <p className="text-lg font-semibold tabular-nums break-words"><AnimatedNumber value={horizonCost} format="inr" /></p>
          <Delta current={horizonCost} base={baselineHorizonCost} invert />
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Margin</p>
          <p className="text-lg font-semibold"><AnimatedNumber value={marginPct} format="percent" /></p>
          <Delta current={marginPct} base={baselineMarginPct} />
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Peak utilisation</p>
          <p className="text-lg font-semibold"><AnimatedNumber value={peakUtilisation} format="percent" /></p>
          <Delta current={peakUtilisation} base={baselinePeakUtilisation} invert />
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{teacherLoad ? "Teacher load (periods/wk)" : "Teacher load (h/wk)"}</p>
          <p className="text-lg font-semibold"><AnimatedNumber value={teacherLoadValue} /></p>
          <Delta current={teacherLoadValue} base={baselineTeacherLoad} invert />
          {teacherLoad && (
            <p className="text-xs text-muted-foreground">Today {teacherLoad.avgPeriodsWeek} of {teacherLoad.maxPeriods} (timetable)</p>
          )}
        </div>
      </div>

      {scenario.risk_flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scenario.risk_flags.map((flag) => (
            <Badge key={flag} variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" aria-hidden />
              {RISK_LABELS[flag] ?? flag}
            </Badge>
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">Sensitivity (±10% per assumption)</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Assumption</th>
                <th className="px-3 py-2">Revenue Δ%</th>
                <th className="px-3 py-2">Cost Δ%</th>
              </tr>
            </thead>
            <tbody>
              {[...sensitivity]
                .sort((a, b) => Math.abs(b.revenue_delta_pct) - Math.abs(a.revenue_delta_pct))
                .map((row) => (
                  <tr key={row.param} className="border-t">
                    <td className="px-3 py-2">{PARAM_LABELS[row.param] ?? row.param}</td>
                    <td className="px-3 py-2 tabular-nums">{row.revenue_delta_pct > 0 ? "+" : ""}{row.revenue_delta_pct}%</td>
                    <td className="px-3 py-2 tabular-nums">{row.cost_delta_pct > 0 ? "+" : ""}{row.cost_delta_pct}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground italic">
        A scenario based on assumptions is not proof that an intervention will produce this outcome.
      </p>
    </div>
  );
}
