"use client";
// One Recharts frame for every dashboard chart: responsive sizing, token
// colors, shared axis/grid/tooltip styling, a screen-reader summary, and an
// empty state. Chart colors 3-5 are < 3:1 on white cards, so callers must also
// print values (LabelList) rather than rely on color alone.
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/states";

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

/** Compact INR for axis ticks only: 13500000 -> "₹1.35 Cr", 4500000 -> "₹45 L", 12500 -> "₹12.5K". Input is rupees. */
export function formatINRCompact(rupees: number): string {
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  if (abs >= 1e7) return `${sign}₹${fmt(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${fmt(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${fmt(abs / 1e3)}K`;
  return `${sign}₹${fmt(abs)}`;
}

export const chartAxis = {
  stroke: "var(--border)",
  tickLine: false,
  tick: { fill: "var(--muted-foreground)", style: { fontSize: "var(--text-xs)" } },
} as const;

export const chartGrid = { stroke: "var(--border)", strokeDasharray: "3 3" } as const;

export const chartTooltip = {
  cursor: { fill: "var(--muted)", opacity: 0.5 },
  contentStyle: {
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-md)",
    fontSize: "var(--text-sm)",
  },
} as const;

export const chartValueLabel = { fill: "var(--foreground)", style: { fontSize: "var(--text-xs)" } } as const;

export function ChartFrame({
  summary,
  heightClass = "h-40",
  empty = false,
  emptyTitle = "No data yet",
  children,
}: {
  /** Screen-reader text describing the data (the chart itself is aria-hidden). */
  summary: string;
  heightClass?: string;
  empty?: boolean;
  emptyTitle?: string;
  children: ReactElement;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{summary}</figcaption>
      {empty ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className={heightClass} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
