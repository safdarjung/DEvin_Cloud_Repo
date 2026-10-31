"use client";
// One Recharts frame for every dashboard chart: responsive sizing, token
// colors, shared axis/grid/tooltip styling, a screen-reader summary, and an
// empty state. Chart colors 3-5 are < 3:1 on white cards, so callers must also
// print values (LabelList) rather than rely on color alone.
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/states";

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

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
