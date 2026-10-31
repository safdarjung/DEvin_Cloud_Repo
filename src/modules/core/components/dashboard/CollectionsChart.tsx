"use client";
// T-039 — term collected vs due.
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, chartValueLabel } from "@/components/chart";

interface CollectionsChartProps {
  collectedPaise: number;
  duePaise: number;
}

// Bug fix (Batch C): dashboard.queries.ts's formatINR is `import "server-only"`
// (Next.js rule: functions can't be passed as props across the Server/Client
// boundary anyway). Duplicated here as a one-liner rather than extracting a
// shared module — this component owns its own display formatting.
function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export function CollectionsChart({ collectedPaise, duePaise }: CollectionsChartProps) {
  const data = [
    { label: "Collected", amount: collectedPaise / 100, fill: "var(--chart-1)" },
    { label: "Due", amount: duePaise / 100, fill: "var(--chart-3)" },
  ];

  return (
    <ChartFrame
      summary={`This term: ${formatINR(collectedPaise)} collected of ${formatINR(duePaise)} due.`}
      empty={collectedPaise === 0 && duePaise === 0}
      emptyTitle="No invoices this term"
    >
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 96 }}>
        <CartesianGrid horizontal={false} {...chartGrid} />
        <XAxis type="number" tickFormatter={(v: number) => formatINR(Math.round(v * 100))} {...chartAxis} />
        <YAxis type="category" dataKey="label" width={72} {...chartAxis} />
        <Tooltip formatter={(v) => formatINR(Math.round(Number(v) * 100))} {...chartTooltip} />
        <Bar dataKey="amount" radius={4}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.fill} />
          ))}
          <LabelList
            dataKey="amount"
            position="right"
            formatter={(v: unknown) => formatINR(Math.round(Number(v) * 100))}
            {...chartValueLabel}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
