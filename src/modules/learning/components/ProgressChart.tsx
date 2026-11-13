"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip } from "@/components/chart";
import type { ProgressWeek } from "@/modules/learning/queries";

const weekFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Weekly practice and online-test percentages. Practice is never official marks. */
export function ProgressChart({ weeks }: { weeks: ProgressWeek[] }) {
  const byWeek = new Map<string, { week: string; label: string; practice?: number; test?: number }>();
  for (const w of weeks) {
    const row = byWeek.get(w.week) ?? { week: w.week, label: weekFmt.format(new Date(`${w.week}T00:00:00+05:30`)) };
    row[w.source] = w.percent;
    byWeek.set(w.week, row);
  }
  const data = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
  return (
    <section aria-labelledby="lp-progress" className="space-y-2">
      <div>
        <h3 id="lp-progress" className="text-base font-semibold tracking-tight">Progress over time</h3>
        <p className="text-sm text-muted-foreground">Weekly average of practice quizzes and online tests. Practice doesn&apos;t affect your marks.</p>
      </div>
      <ChartFrame
        summary={`Weekly percent: ${data.map((d) => `${d.label} practice ${d.practice ?? "none"}, tests ${d.test ?? "none"}`).join("; ")}.`}
        heightClass="h-56"
        empty={data.length === 0}
        emptyTitle="No practice or test results yet"
      >
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} {...chartGrid} />
          <XAxis dataKey="label" {...chartAxis} />
          <YAxis domain={[0, 100]} width={32} {...chartAxis} />
          <Tooltip {...chartTooltip} formatter={(v) => `${v}%`} />
          <Line isAnimationActive={false} connectNulls dataKey="practice" name="Practice" stroke="var(--chart-1)" strokeWidth={2} dot />
          <Line isAnimationActive={false} connectNulls dataKey="test" name="Online tests" stroke="var(--chart-2)" strokeWidth={2} dot />
        </LineChart>
      </ChartFrame>
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span><span aria-hidden className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--chart-1)]" />Practice</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-3 rounded-sm bg-[var(--chart-2)]" />Online tests</span>
      </p>
    </section>
  );
}
