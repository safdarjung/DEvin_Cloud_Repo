"use client";
// features-18 §D — Monte Carlo band (P10/P50/P90 of cumulative surplus,
// 500 seeded runs over runScenario) and goal seek (bisection on fee change
// for a target monthly surplus). Both pure TS in lab.ts, recomputed locally.
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { LimitedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inr } from "@/lib/format";
import type { BaselineFacts } from "@/modules/fabric/demo/simulator";
import { goalSeekFeeChange, monteCarloSurplus, type GoalSeekResult } from "@/modules/fabric/lab";
import type { ScenarioAssumptions } from "@/modules/fabric/types";

const SEED = 20261110;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function RiskPanel({
  assumptions,
  facts,
  spread,
  onApplyFee,
}: {
  assumptions: ScenarioAssumptions;
  facts: BaselineFacts;
  /** σ of monthly revenue, percent; fromBacktest = fee forecast backtest error, else the stated default. */
  spread: { sigmaPct: number; fromBacktest: boolean };
  onApplyFee: (feeChangePct: number) => void;
}) {
  const band = useMemo(() => monteCarloSurplus(assumptions, facts, { sigmaPct: spread.sigmaPct, seed: SEED }), [assumptions, facts, spread.sigmaPct]);
  const [target, setTarget] = useState("");
  const [goal, setGoal] = useState<GoalSeekResult | null>(null);

  const chartData = band.months.map((ym, i) => ({
    label: monthLabel(ym),
    p10: band.p10[i]! / 100,
    p50: band.p50[i]! / 100,
    p90: band.p90[i]! / 100,
  }));
  const last = chartData[chartData.length - 1];

  function solve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const rupees = Number(target);
    if (target.trim() === "" || !Number.isFinite(rupees)) return;
    setGoal(goalSeekFeeChange(assumptions, facts, Math.round(rupees * 100)));
  }

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Range of outcomes (Monte Carlo)</p>
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {band.runs} runs; each month&apos;s revenue varies by ±{spread.sigmaPct}% (one standard deviation),{" "}
          {spread.fromBacktest ? "taken from the fee forecast's backtest error." : "a default — no fee forecast backtest yet."}
          {!spread.fromBacktest && <LimitedBadge />}
        </p>
      </div>
      <ChartFrame
        summary={
          last
            ? `Cumulative surplus after ${chartData.length} months: P10 ${inr(last.p10)}, median ${inr(last.p50)}, P90 ${inr(last.p90)}.`
            : "No months to simulate."
        }
        heightClass="h-56"
      >
        <ComposedChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} {...chartGrid} />
          <XAxis dataKey="label" {...chartAxis} />
          <YAxis tickFormatter={formatINRCompact} width={64} {...chartAxis} />
          <Tooltip formatter={(v) => inr(Number(v))} {...chartTooltip} />
          <Legend />
          <Area dataKey="p90" name="P10–P90 band" stroke="none" fill="var(--chart-1)" fillOpacity={0.15} isAnimationActive animationDuration={300} />
          <Area dataKey="p10" stroke="none" fill="var(--background)" fillOpacity={1} legendType="none" isAnimationActive animationDuration={300} />
          <Line dataKey="p50" name="Median (P50)" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive animationDuration={300} />
        </ComposedChart>
      </ChartFrame>
      <p className="text-xs text-muted-foreground">Cumulative surplus (revenue minus cost) from month 1. One in ten runs falls below the band, one in ten above.</p>

      <form onSubmit={solve} className="space-y-2 border-t pt-3">
        <label htmlFor="sim-goal" className="text-sm font-medium">
          Goal seek: fee change for a target monthly surplus
        </label>
        <div className="flex gap-2">
          <Input
            id="sim-goal"
            type="number"
            inputMode="numeric"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setGoal(null);
            }}
            placeholder="Target surplus, ₹ per month"
            className="h-8"
          />
          <Button type="submit" variant="outline" size="sm" disabled={target.trim() === ""}>
            Solve
          </Button>
        </div>
        {goal?.ok && (
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            <span>
              Fee change needed: <span className="font-medium tabular-nums">{goal.feeChangePct > 0 ? "+" : ""}{goal.feeChangePct}%</span>
              {goal.feeChangePct === -10 && " (the target is met even at the lowest fee in range)"}
            </span>
            <Button type="button" size="sm" variant="secondary" onClick={() => onApplyFee(Math.ceil(goal.feeChangePct))}>
              Apply {Math.ceil(goal.feeChangePct)}% to the slider
            </Button>
          </div>
        )}
        {goal && !goal.ok && (
          <p className="text-sm text-destructive" aria-live="polite">
            Not reachable with a fee change between −10% and +25%: the best is {inr(goal.bestSurplusPaise / 100)} a month at +{goal.bestFeeChangePct}%.
            Try changing staff or cost assumptions instead.
          </p>
        )}
      </form>
    </div>
  );
}
