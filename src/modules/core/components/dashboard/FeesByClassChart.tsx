"use client";
// Dashboard: this term's fees per class (grade), collected vs outstanding,
// from finance.collectionReport(groupBy: "grade"). Rupee values.
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { inr } from "@/lib/format";

export interface FeesByClassRow {
  label: string;
  collected: number;
  outstanding: number;
}

export function FeesByClassChart({ rows }: { rows: FeesByClassRow[] }) {
  const total = rows.reduce((s, r) => s + r.collected + r.outstanding, 0);
  const worst = [...rows].sort((a, b) => b.outstanding - a.outstanding)[0];
  return (
    <ChartFrame
      heightClass="h-64"
      summary={`Fees by class this term. ${rows.map((r) => `${r.label}: ${inr(r.collected)} collected, ${inr(r.outstanding)} outstanding`).join("; ")}.${worst ? ` Largest outstanding: ${worst.label}.` : ""}`}
      empty={rows.length === 0 || total === 0}
      emptyTitle="No invoices this term"
    >
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} {...chartGrid} />
        <XAxis dataKey="label" interval={0} {...chartAxis} />
        <YAxis tickFormatter={formatINRCompact} width={56} {...chartAxis} />
        <Tooltip formatter={(v) => inr(Number(v))} {...chartTooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="collected" name="Collected" stackId="fees" fill="var(--chart-1)" animationDuration={900} />
        <Bar dataKey="outstanding" name="Outstanding" stackId="fees" fill="var(--chart-3)" radius={[4, 4, 0, 0]} animationDuration={900} />
      </BarChart>
    </ChartFrame>
  );
}
