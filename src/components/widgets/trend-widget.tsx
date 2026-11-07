"use client";
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { Widget, type WidgetProps } from "@/components/widgets/widget";
import { inr } from "@/lib/format";

export type TrendUnit = "percent" | "inr" | "count";

const tick: Record<TrendUnit, (n: number) => string> = {
  percent: (n) => `${n}%`,
  inr: formatINRCompact,
  count: (n) => n.toLocaleString("en-IN"),
};
const full: Record<TrendUnit, (n: number) => string> = {
  percent: (n) => `${+n.toFixed(1)}%`,
  inr: inr,
  count: (n) => n.toLocaleString("en-IN"),
};

export function TrendWidget({
  data,
  unit,
  target,
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & {
  data: { label: string; value: number }[];
  unit: TrendUnit;
  /** Draws a dashed reference line. */
  target?: number;
}) {
  const reduce = useReducedMotion();
  const first = data[0];
  const last = data.at(-1);
  const summary = last
    ? `${frame.title}: ${data.length} points from ${first.label} (${full[unit](first.value)}) to ${last.label} (${full[unit](last.value)}).`
    : `${frame.title}: no data.`;
  return (
    <Widget {...frame}>
      <ChartFrame summary={summary} heightClass="h-48" empty={data.length === 0} emptyTitle="No trend data yet">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...chartGrid} />
          <XAxis dataKey="label" minTickGap={24} {...chartAxis} />
          <YAxis width={48} tickFormatter={tick[unit]} domain={unit === "percent" ? [(min: number) => Math.max(0, Math.floor(min - 4)), 100] : [0, "auto"]} {...chartAxis} />
          <Tooltip {...chartTooltip} formatter={(v) => full[unit](Number(v))} />
          {target !== undefined && <ReferenceLine y={target} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Target ${full[unit](target)}`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }} />}
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="var(--chart-1)"
            fillOpacity={0.25}
            isAnimationActive={!reduce}
            animationDuration={600}
          />
        </AreaChart>
      </ChartFrame>
    </Widget>
  );
}
