"use client";
// T-039 — today's present/absent split. Two bars, not a line (there's one
// data point: today), colored with the app's existing --chart-1/2 tokens
// (src/app/globals.css) so it matches light/dark without a new palette.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
    <figure>
      <p className="sr-only">
        Today: {data[0].count} present, {data[1].count} absent, of {totalInDenominator} marked.
      </p>
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={64} />
            <Tooltip />
            <Bar dataKey="count" radius={4}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
