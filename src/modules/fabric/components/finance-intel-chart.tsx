"use client";
// Observed collections (bars) vs forecast (dashed line + shaded band). The
// chart is aria-hidden by ChartFrame; the server page renders the same rows as
// a table, and `summary` carries the text alternative.
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { inr } from "@/lib/format";

export interface FinanceChartPoint {
  label: string;
  /** Rupees; null for forecast months. */
  observed: number | null;
  /** Rupees; null for observed months. */
  forecast: number | null;
  /** [low, high] rupees; null for observed months. */
  band: [number, number] | null;
}

export function FinanceIntelChart({ data, summary }: { data: FinanceChartPoint[]; summary: string }) {
  return (
    <ChartFrame summary={summary} heightClass="h-60 sm:h-72" empty={data.length === 0} emptyTitle="No forecast yet">
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} {...chartGrid} />
        <XAxis dataKey="label" {...chartAxis} />
        <YAxis tickFormatter={formatINRCompact} width={64} {...chartAxis} />
        <Tooltip formatter={(v) => (Array.isArray(v) ? `${inr(Number(v[0]))} – ${inr(Number(v[1]))}` : inr(Number(v)))} {...chartTooltip} />
        <Legend />
        <Area isAnimationActive={false} dataKey="band" name="Forecast range" stroke="none" fill="var(--chart-2)" fillOpacity={0.18} />
        <Bar isAnimationActive={false} dataKey="observed" name="Collected (observed)" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Line isAnimationActive={false} dataKey="forecast" name="Forecast (expected)" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} />
      </ComposedChart>
    </ChartFrame>
  );
}
