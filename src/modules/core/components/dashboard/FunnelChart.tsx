"use client";
// T-039 — enquiry stage counts, worst-to-best read top-to-bottom like a
// funnel. Application-status counts are shown as a plain list beside it
// (short, fixed set — a second chart would be noise).
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, chartValueLabel } from "@/components/chart";
import type { AdmissionsFunnelCounts } from "@/modules/admissions/queries";

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  visit_scheduled: "Visit scheduled",
  visited: "Visited",
  application_sent: "Application sent",
  applied: "Applied",
};

function stageLabel(key: string): string {
  if (STAGE_LABELS[key]) return STAGE_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface FunnelChartProps {
  funnel: AdmissionsFunnelCounts;
}

export function FunnelChart({ funnel }: FunnelChartProps) {
  const stageData = Object.entries(funnel.enquiryStages).map(([key, count]) => ({ label: stageLabel(key), count }));
  const applicationEntries = Object.entries(funnel.applicationStatuses).filter(([, count]) => count > 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ChartFrame
        summary={`Enquiries by stage: ${stageData.map((s) => `${s.label} ${s.count}`).join(", ")}.`}
        heightClass="h-48"
        empty={stageData.every((s) => s.count === 0)}
        emptyTitle="No enquiries yet"
      >
        <BarChart data={stageData} layout="vertical" margin={{ left: 0, right: 32 }}>
          <CartesianGrid horizontal={false} {...chartGrid} />
          <XAxis type="number" allowDecimals={false} {...chartAxis} />
          <YAxis type="category" dataKey="label" width={112} {...chartAxis} />
          <Tooltip {...chartTooltip} />
          <Bar dataKey="count" fill="var(--chart-2)" radius={4}>
            <LabelList dataKey="count" position="right" {...chartValueLabel} />
          </Bar>
        </BarChart>
      </ChartFrame>

      <ul className="space-y-1 text-sm">
        {applicationEntries.length === 0 && <li className="text-muted-foreground">No applications yet.</li>}
        {applicationEntries.map(([status, count]) => (
          <li key={status} className="flex justify-between gap-2 border-border border-b py-1 last:border-0">
            <span>{stageLabel(status)}</span>
            <span className="font-medium">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
