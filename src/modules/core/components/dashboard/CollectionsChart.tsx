"use client";
// T-039 — term collected vs due. Money is formatted from integer paise by
// the caller (formatINR, dashboard.queries.ts) — this component never does
// its own money math.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface CollectionsChartProps {
  collectedPaise: number;
  duePaise: number;
  formatINR: (paise: number) => string;
}

export function CollectionsChart({ collectedPaise, duePaise, formatINR }: CollectionsChartProps) {
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
