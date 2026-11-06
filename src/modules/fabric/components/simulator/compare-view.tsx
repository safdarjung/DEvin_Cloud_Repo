"use client";
// F-UI-08 "Compare": pick 2 saved scenarios, show their headline KPIs
// side by side. Skipped vs the packet's "both lines on one chart" — a
// plain table reads better for the 2-row case and skips a second chart
// component for little benefit (ponytail: smallest complete change).
import { inr } from "@/lib/format";
import { runScenario, type BaselineFacts } from "@/modules/fabric/demo/simulator";
import type { SavedScenario } from "@/modules/fabric/simulator.queries";

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function CompareView({ scenarios, facts }: { scenarios: [SavedScenario, SavedScenario]; facts: BaselineFacts }) {
  const rows = scenarios.map((s) => {
    const results = runScenario(s.assumptions, facts);
    const revenue = sum(results.revenue_paise) / 100;
    const cost = sum(results.cost_paise) / 100;
    const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100;
    const peak = Math.max(...results.capacity_utilisation_pct, 0);
    return { scenario: s, revenue, cost, margin, peak, risks: results.risk_flags.length };
  });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Scenario</th>
            <th className="px-3 py-2">Revenue</th>
            <th className="px-3 py-2">Cost</th>
            <th className="px-3 py-2">Margin</th>
            <th className="px-3 py-2">Peak utilisation</th>
            <th className="px-3 py-2">Risk flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ scenario, revenue, cost, margin, peak, risks }) => (
            <tr key={scenario.id} className="border-t">
              <td className="px-3 py-2 font-medium">{scenario.name}</td>
              <td className="px-3 py-2 tabular-nums">{inr(revenue)}</td>
              <td className="px-3 py-2 tabular-nums">{inr(cost)}</td>
              <td className="px-3 py-2 tabular-nums">{margin.toFixed(1)}%</td>
              <td className="px-3 py-2 tabular-nums">{peak.toFixed(1)}%</td>
              <td className="px-3 py-2 tabular-nums">{risks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
