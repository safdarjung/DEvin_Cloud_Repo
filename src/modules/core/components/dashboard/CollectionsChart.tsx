"use client";
// T-039 — term collected vs due.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
    <figure>
      <p className="sr-only">
        This term: {formatINR(collectedPaise)} collected of {formatINR(duePaise)} due.
      </p>
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatINR(Math.round(v * 100))} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={64} />
            <Tooltip formatter={(v) => formatINR(Math.round(Number(v) * 100))} />
            <Bar dataKey="amount" radius={4}>
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
