"use client";
// T-039 — per-grade result counts for one exam, sorted best-to-worst grade.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface GradeDistributionChartProps {
  distribution: Record<string, number>;
}

export function GradeDistributionChart({ distribution }: GradeDistributionChartProps) {
  const data = Object.entries(distribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([grade, count]) => ({ grade, count }));

  return (
    <figure>
      <p className="sr-only">Grade distribution: {data.map((d) => `${d.grade} ${d.count}`).join(", ")}.</p>
      <div className="h-48" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="grade" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={32} />
            <Tooltip />
            <Bar dataKey="count" fill="var(--chart-1)" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
