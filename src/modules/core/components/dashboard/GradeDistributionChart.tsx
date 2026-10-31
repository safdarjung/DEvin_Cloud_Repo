"use client";
// T-039 — per-grade result counts for one exam, sorted best-to-worst grade.
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, chartValueLabel } from "@/components/chart";

interface GradeDistributionChartProps {
  distribution: Record<string, number>;
}

export function GradeDistributionChart({ distribution }: GradeDistributionChartProps) {
  const data = Object.entries(distribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([grade, count]) => ({ grade, count }));

  return (
    <ChartFrame
      summary={`Grade distribution: ${data.map((d) => `${d.grade} ${d.count}`).join(", ")}.`}
      heightClass="h-48"
      empty={data.length === 0}
      emptyTitle="No results yet"
    >
      <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...chartGrid} />
        <XAxis dataKey="grade" {...chartAxis} />
        <YAxis allowDecimals={false} width={32} {...chartAxis} />
        <Tooltip {...chartTooltip} />
        <Bar dataKey="count" fill="var(--chart-1)" radius={4}>
          <LabelList dataKey="count" position="top" {...chartValueLabel} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
