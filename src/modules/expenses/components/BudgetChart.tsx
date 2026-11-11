"use client";
// Budget vs actual per category and period, in rupees for display only (data is paise).
// The table beside it carries the over/under status in text; colour is not the only signal.
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { inr } from "@/lib/format";

export interface BudgetChartRow {
  label: string;
  budget: number;
  actual: number;
}

export function BudgetChart({ rows }: { rows: BudgetChartRow[] }) {
  const over = rows.filter((r) => r.actual > r.budget).map((r) => r.label);
  return (
    <ChartFrame
      heightClass="h-64"
      summary={`Budget vs actual. ${rows.map((r) => `${r.label}: budget ${inr(r.budget)}, spent ${inr(r.actual)}`).join("; ")}.${over.length ? ` Over budget: ${over.join(", ")}.` : " Nothing is over budget."}`}
      empty={rows.length === 0}
      emptyTitle="No budgets in this period"
    >
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} {...chartGrid} />
        <XAxis dataKey="label" interval={0} {...chartAxis} />
        <YAxis tickFormatter={formatINRCompact} width={56} {...chartAxis} />
        <Tooltip formatter={(v) => inr(Number(v))} {...chartTooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="budget" name="Budget" fill="var(--chart-2)" radius={[4, 4, 0, 0]} animationDuration={900} />
        <Bar dataKey="actual" name="Spent" fill="var(--chart-1)" radius={[4, 4, 0, 0]} animationDuration={900} />
      </BarChart>
    </ChartFrame>
  );
}
