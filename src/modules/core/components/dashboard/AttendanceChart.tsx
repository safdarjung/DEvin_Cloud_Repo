"use client";
// T-039 — today's present/absent split. Two bars, not a line (there's one
// data point: today), colored with the app's existing --chart-1/2 tokens
// (src/app/globals.css) so it matches light/dark without a new palette.
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, chartValueLabel } from "@/components/chart";

interface AttendanceChartProps {
  presentWeighted: number;
  totalInDenominator: number;
}

export function AttendanceChart({ presentWeighted, totalInDenominator }: AttendanceChartProps) {
  const absent = Math.max(totalInDenominator - presentWeighted, 0);
  const data = [
    { label: "Present", count: Math.round(presentWeighted * 100) / 100, fill: "var(--chart-1)" },
    { label: "Absent", count: Math.round(absent * 100) / 100, fill: "var(--chart-3)" },
  ];

  return (
    <ChartFrame
      summary={`Today: ${data[0].count} present, ${data[1].count} absent, of ${totalInDenominator} marked.`}
      empty={totalInDenominator === 0}
      emptyTitle="No attendance marked today"
    >
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32 }}>
        <CartesianGrid horizontal={false} {...chartGrid} />
        <XAxis type="number" allowDecimals={false} {...chartAxis} />
        <YAxis type="category" dataKey="label" width={64} {...chartAxis} />
        <Tooltip {...chartTooltip} />
        <Bar dataKey="count" radius={4}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.fill} />
          ))}
          <LabelList dataKey="count" position="right" {...chartValueLabel} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
