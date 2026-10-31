"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartBlock } from "@/modules/ai/blocks/schemas";

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

interface ChartBlockViewProps {
  block: ChartBlock;
  /** No `dataRef` binding exists yet (GU-17, wave 2) — every chart rendered today is model-generated numbers. */
  source?: "ai" | "school-records";
}

function mergedRows(block: ChartBlock): Array<Record<string, string | number>> {
  const pointCount = Math.max(...block.series.map((series) => series.points.length));
  return Array.from({ length: pointCount }, (_, index) => {
    const row: Record<string, string | number> = { label: block.series[0]?.points[index]?.label ?? "" };
    for (const series of block.series) {
      row[series.name] = series.points[index]?.value ?? 0;
    }
    return row;
  });
}

export function ChartBlockView({ block, source = "ai" }: ChartBlockViewProps) {
  const sourceLabel = source === "ai" ? "AI-generated numbers — may be wrong" : "From school records";

  if (block.chartType === "pie") {
    const data = block.series[0]?.points.map((point) => ({ name: point.label, value: point.value })) ?? [];
    return (
      <figure>
        <p className="sr-only">{data.map((d) => `${d.name} ${d.value}`).join(", ")}.</p>
        <div className="h-48" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" outerRadius={70}>
                {data.map((_, index) => (
                  <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <figcaption className="text-muted-foreground text-xs">{sourceLabel}</figcaption>
      </figure>
    );
  }

  const rows = mergedRows(block);
  const summary = rows.map((row) => `${row.label}: ${block.series.map((s) => `${s.name} ${row[s.name]}`).join(", ")}`);

  return (
    <figure>
      <p className="sr-only">{summary.join(". ")}.</p>
      <div className="h-48" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          {block.chartType === "line" ? (
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={32} unit={block.unit} />
              <Tooltip />
              {block.series.map((series, index) => (
                <Line isAnimationActive={false} key={series.name} dataKey={series.name} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} />
              ))}
            </LineChart>
          ) : block.chartType === "area" ? (
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={32} unit={block.unit} />
              <Tooltip />
              {block.series.map((series, index) => (
                <Area
                  isAnimationActive={false}
                  key={series.name}
                  dataKey={series.name}
                  stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                  fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={32} unit={block.unit} />
              <Tooltip />
              {block.series.map((series, index) => (
                <Bar isAnimationActive={false} key={series.name} dataKey={series.name} fill={SERIES_COLORS[index % SERIES_COLORS.length]} radius={4} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <figcaption className="text-muted-foreground text-xs">{sourceLabel}</figcaption>
    </figure>
  );
}
