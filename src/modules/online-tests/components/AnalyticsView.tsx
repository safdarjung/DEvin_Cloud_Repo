"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, chartValueLabel } from "@/components/chart";
import { BarList } from "@/components/widgets/viz";
import type { TestAnalyticsResult } from "@/modules/online-tests/queries";
import { fmtNum } from "./test-ui";

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function AnalyticsView({ data, topicNames }: { data: TestAnalyticsResult; topicNames: Record<string, string> }) {
  const qNo = new Map(data.items.map((i, n) => [i.key, n + 1]));
  const chart = data.questions.map((q) => ({ q: `Q${qNo.get(q.key)}`, percent: q.percentCorrect ?? q.averagePercent ?? 0 }));
  const hardest = data.hardest.map((k) => data.questions.find((q) => q.key === k)).filter((q) => q !== undefined);
  const tiles: [string, string][] = [
    ["Submitted", String(data.submitted)],
    ["Evaluated", String(data.evaluated)],
    ["Average", `${fmtNum(data.average)} / ${fmtNum(data.totalMarks)}`],
    ["Highest", fmtNum(data.highest)],
    ["Lowest", fmtNum(data.lowest)],
  ];
  const groups = [...data.topics, ...data.chapters].map((g) => ({ label: topicNames[g.id] ?? "Topic", value: g.averagePercent, display: `${fmtNum(g.averagePercent)}%` }));

  return (
    <div className="space-y-8" data-testid="analytics">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, v]) => (
          <div key={label} className="rounded-lg border bg-card p-3" data-testid={`stat-${label.toLowerCase()}`}>
            <p className="text-xl font-semibold tabular-nums">{v}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <section aria-labelledby="q-h">
        <h2 id="q-h" className="mb-2 text-base font-semibold">Per question: % who got full marks (written answers: average %)</h2>
        <ChartFrame summary={`Percent per question: ${chart.map((c) => `${c.q} ${c.percent}%`).join(", ")}.`} heightClass="h-56" empty={chart.length === 0} emptyTitle="No answers yet">
          <BarChart data={chart} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} {...chartGrid} />
            <XAxis dataKey="q" {...chartAxis} />
            <YAxis domain={[0, 100]} width={32} {...chartAxis} />
            <Tooltip {...chartTooltip} />
            <Bar isAnimationActive={false} dataKey="percent" fill="var(--chart-1)" radius={4}>
              <LabelList dataKey="percent" position="top" {...chartValueLabel} />
            </Bar>
          </BarChart>
        </ChartFrame>
      </section>

      <section aria-labelledby="h-h">
        <h2 id="h-h" className="mb-2 text-base font-semibold">Hardest questions</h2>
        {hardest.length === 0 ? <p className="text-sm text-muted-foreground">Not enough data yet.</p> : (
          <ol className="space-y-1 text-sm" data-testid="hardest">
            {hardest.map((q) => <li key={q.key}>Q{qNo.get(q.key)}: {clip(q.body)} <span className="text-muted-foreground">({fmtNum(q.percentCorrect ?? q.averagePercent)}%)</span></li>)}
          </ol>
        )}
      </section>

      <section aria-labelledby="t-h">
        <h2 id="t-h" className="mb-2 text-base font-semibold">By topic</h2>
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">Questions in this paper are not tagged to topics.</p> : <BarList ariaLabel="Average percent by topic" max={100} format="percent" items={groups} />}
      </section>

      <section aria-labelledby="w-h">
        <h2 id="w-h" className="mb-2 text-base font-semibold">Common wrong answers</h2>
        <ul className="space-y-2 text-sm" data-testid="wrong-answers">
          {data.questions.filter((q) => q.commonWrong.length > 0).map((q) => (
            <li key={q.key}>
              <span className="font-medium">Q{qNo.get(q.key)}</span> {clip(q.body, 60)}
              <ul className="ml-4 list-disc text-muted-foreground">{q.commonWrong.map((w) => <li key={w.answer}>{clip(w.answer, 60)} ({w.count})</li>)}</ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
