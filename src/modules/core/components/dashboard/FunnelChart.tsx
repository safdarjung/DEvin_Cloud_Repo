"use client";
// T-039 — enquiry stage counts, worst-to-best read top-to-bottom like a
// funnel. Application-status counts are shown as a plain list beside it
// (short, fixed set — a second chart would be noise).
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AdmissionsFunnelCounts } from "@/modules/admissions/queries";

interface FunnelChartProps {
  funnel: AdmissionsFunnelCounts;
}

export function FunnelChart({ funnel }: FunnelChartProps) {
  const stageData = Object.entries(funnel.enquiryStages).map(([label, count]) => ({ label, count }));
  const applicationEntries = Object.entries(funnel.applicationStatuses).filter(([, count]) => count > 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <figure>
        <p className="sr-only">Enquiries by stage: {stageData.map((s) => `${s.label} ${s.count}`).join(", ")}.</p>
        <div className="h-48" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={88} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-2)" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <ul className="space-y-1 text-sm">
        {applicationEntries.length === 0 && <li className="text-muted-foreground">No applications yet.</li>}
        {applicationEntries.map(([status, count]) => (
          <li key={status} className="flex justify-between gap-2 border-border border-b py-1 last:border-0">
            <span className="capitalize">{status.replace(/_/g, " ")}</span>
            <span className="font-medium">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
