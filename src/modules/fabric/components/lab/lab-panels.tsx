"use client";
// features-18 §D — Analysis lab panels. Every number comes from the 0125
// functions (computed in SQL, groups < 5 students already dropped); captions
// are deterministic (lab.ts). AI only narrates, behind "Explain with AI".
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, chartAxis, chartGrid, chartTooltip, formatINRCompact } from "@/components/chart";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { inr } from "@/lib/format";
import {
  anomalyCaption,
  BAND_LABEL,
  correlationCaption,
  feeCohortCaption,
  round,
  sectionLabel,
  strongestAnomaly,
  trendBreakCaption,
  type LabAnomalyRow,
  type LabCorrelationRow,
  type LabFeeCohortRow,
  type LabTrendRow,
} from "@/modules/fabric/lab";
import type { LabPanelKind } from "@/modules/fabric/lab.schemas";
import { ExplainButton } from "./explain-button";

const PANEL_FAILED = <ErrorState bare title="Could not load this analysis" description="The other panels are unaffected. Reload the page to try again." />;

const SUPPRESSED = "Groups with fewer than 5 students are hidden to protect privacy. Figures also need submitted daily attendance, published marks or issued invoices.";

function Panel({
  title,
  caption,
  explain,
  children,
}: {
  title: string;
  caption: string | null;
  explain: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={title}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {caption && <p className="text-sm text-muted-foreground">{caption}</p>}
      </div>
      {children}
      {explain}
    </section>
  );
}

const fmt = (v: number | null, suffix = ""): string => (v == null ? "—" : `${round(v)}${suffix}`);

function zTint(z: number | null): string {
  if (z == null) return "";
  const abs = Math.abs(z);
  if (abs >= 2) return "bg-destructive/20";
  if (abs >= 1) return "bg-amber-500/15";
  return "";
}

const byStrongest = (a: LabAnomalyRow, b: LabAnomalyRow): number =>
  Math.abs(strongestAnomaly(b)?.z ?? 0) - Math.abs(strongestAnomaly(a)?.z ?? 0);

export function LabPanels({
  institutionSlug,
  canExplain,
  correlation,
  anomalies,
  feeRisk,
  trends,
}: {
  institutionSlug: string;
  canExplain: boolean;
  /** null = that panel's query failed; the panel shows an error, the rest still render. */
  correlation: LabCorrelationRow[] | null;
  anomalies: LabAnomalyRow[] | null;
  feeRisk: LabFeeCohortRow[] | null;
  trends: LabTrendRow[] | null;
}) {
  const explain = (kind: LabPanelKind, hasRows: boolean) =>
    canExplain && hasRows ? <ExplainButton institutionSlug={institutionSlug} kind={kind} /> : null;

  const corr = (correlation ?? []).filter((r) => r.pearson_r != null).sort((a, b) => Math.abs(b.pearson_r!) - Math.abs(a.pearson_r!));
  const corrChart = corr.slice(0, 12).map((r) => ({ label: `${sectionLabel(r)} · ${r.subject}`, r: round(r.pearson_r!, 2) }));
  const anomalyRows = [...(anomalies ?? [])].sort(byStrongest);
  const fee = feeRisk ?? [];
  const overdueTop = [...fee].sort((a, b) => b.overdue_paise - a.overdue_paise)[0];
  const bands = Object.keys(BAND_LABEL);
  const feeChart = [...new Set(fee.map((r) => r.grade))].map((grade) => ({
    grade,
    ...Object.fromEntries(bands.map((band) => [band, (fee.find((r) => r.grade === grade && r.attendance_band === band)?.overdue_paise ?? 0) / 100])),
  }));
  const bandColor: Record<string, string> = {
    critical: "var(--destructive)",
    warning: "var(--chart-4)",
    ok: "var(--chart-2)",
    no_data: "var(--muted-foreground)",
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
      <Panel
        title="Attendance vs marks"
        caption={corr[0] ? correlationCaption(corr[0]) : null}
        explain={explain("correlation", corr.length > 0)}
      >
        {correlation === null ? (
          PANEL_FAILED
        ) : corr.length === 0 ? (
          <EmptyState bare title="No section and subject has enough students to compare yet" description={SUPPRESSED} />
        ) : (
          <>
            <ChartFrame
              summary={`Correlation between attendance and marks for the ${corrChart.length} strongest section-subject pairs.`}
              heightClass="h-72"
            >
              <BarChart data={corrChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} {...chartGrid} />
                <XAxis type="number" domain={[-1, 1]} {...chartAxis} />
                <YAxis type="category" dataKey="label" width={150} {...chartAxis} />
                <ReferenceLine x={0} stroke="var(--border)" />
                <Tooltip formatter={(v) => `r = ${v}`} {...chartTooltip} />
                <Bar dataKey="r" name="r" isAnimationActive animationDuration={300}>
                  {corrChart.map((d) => (
                    <Cell key={d.label} fill={d.r >= 0 ? "var(--chart-1)" : "var(--chart-2)"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartFrame>
            <div className="max-h-64 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">n</th>
                    <th className="px-3 py-2">r</th>
                    <th className="px-3 py-2">Avg attendance</th>
                    <th className="px-3 py-2">Avg mark</th>
                  </tr>
                </thead>
                <tbody>
                  {corr.map((r) => (
                    <tr key={`${r.class_section_id}-${r.subject_id}`} className="border-t">
                      <td className="px-3 py-1.5">{sectionLabel(r)}</td>
                      <td className="px-3 py-1.5">{r.subject}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.n}</td>
                      <td className="px-3 py-1.5 tabular-nums">{round(r.pearson_r!, 2)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmt(r.avg_attendance_pct, "%")}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmt(r.avg_mark_pct, "%")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">A correlation shows two things move together; it does not show that one causes the other.</p>
          </>
        )}
      </Panel>

      <Panel
        title="Sections that stand out"
        caption={anomalyRows[0] ? anomalyCaption(anomalyRows[0]) : null}
        explain={explain("anomalies", anomalyRows.length > 0)}
      >
        {anomalies === null ? (
          PANEL_FAILED
        ) : anomalyRows.length === 0 ? (
          <EmptyState bare title="No section has 5 or more active students yet" description={SUPPRESSED} />
        ) : (
          <>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Attendance (z)</th>
                    <th className="px-3 py-2">Avg mark (z)</th>
                    <th className="px-3 py-2">Overdue invoices (z)</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalyRows.map((r) => (
                    <tr key={r.class_section_id} className="border-t">
                      <td className="px-3 py-1.5">
                        {sectionLabel(r)} <span className="text-xs text-muted-foreground">({r.students})</span>
                      </td>
                      <td className={`px-3 py-1.5 tabular-nums ${zTint(r.attendance_z)}`}>
                        {fmt(r.attendance_pct, "%")} ({fmt(r.attendance_z)})
                      </td>
                      <td className={`px-3 py-1.5 tabular-nums ${zTint(r.mark_z)}`}>
                        {fmt(r.avg_mark_pct, "%")} ({fmt(r.mark_z)})
                      </td>
                      <td className={`px-3 py-1.5 tabular-nums ${zTint(r.fee_overdue_z)}`}>
                        {fmt(r.fee_overdue_rate, "%")} ({fmt(r.fee_overdue_z)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              z = how many standard deviations a section sits from the school average. Shaded: |z| ≥ 1 (amber), |z| ≥ 2 (red). “—” = fewer than 5 students
              contributed.
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="Fee risk by attendance"
        caption={overdueTop && overdueTop.overdue_invoices > 0 ? feeCohortCaption(overdueTop) : fee.length > 0 ? "No cohort has overdue invoices." : null}
        explain={explain("fee_risk", fee.length > 0)}
      >
        {feeRisk === null ? (
          PANEL_FAILED
        ) : fee.length === 0 ? (
          <EmptyState bare title="No grade has a cohort of 5 or more students yet" description={SUPPRESSED} />
        ) : (
          <>
            {/* The query runs with the viewer's own access: roles that can't read attendance get every row as no_data. */}
            {fee.every((r) => r.attendance_band === "no_data") && (
              <p className="text-sm text-muted-foreground">
                Attendance bands show only for roles that can see attendance, such as the principal. Your role sees the fee side.
              </p>
            )}
            <ChartFrame
              summary={`Overdue fees by grade, split by attendance band, across ${feeChart.length} grades.`}
              heightClass="h-64"
              empty={!overdueTop || overdueTop.overdue_paise === 0}
              emptyTitle="No overdue fees in any cohort"
            >
              <BarChart data={feeChart} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} {...chartGrid} />
                <XAxis dataKey="grade" {...chartAxis} />
                <YAxis tickFormatter={formatINRCompact} width={64} {...chartAxis} />
                <Tooltip formatter={(v) => inr(Number(v))} {...chartTooltip} />
                <Legend />
                {bands.map((band) => (
                  <Bar key={band} dataKey={band} name={BAND_LABEL[band]} stackId="fee" fill={bandColor[band]} isAnimationActive animationDuration={300} />
                ))}
              </BarChart>
            </ChartFrame>
            <div className="max-h-64 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Grade</th>
                    <th className="px-3 py-2">Attendance band</th>
                    <th className="px-3 py-2">Students</th>
                    <th className="px-3 py-2">Overdue / invoices</th>
                    <th className="px-3 py-2">Overdue amount</th>
                    <th className="px-3 py-2">Avg days late</th>
                  </tr>
                </thead>
                <tbody>
                  {fee.map((r) => (
                    <tr key={`${r.grade_id}-${r.attendance_band}`} className="border-t">
                      <td className="px-3 py-1.5">{r.grade}</td>
                      <td className="px-3 py-1.5">{BAND_LABEL[r.attendance_band] ?? r.attendance_band}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.students}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {r.overdue_invoices} / {r.invoices}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{inr(r.overdue_paise / 100)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmt(r.avg_days_overdue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Attendance trend breaks"
        caption="Last 4 complete weeks vs the 8 before. A break is a drop larger than twice the section's usual week-to-week swing."
        explain={explain("trend_breaks", (trends ?? []).length > 0)}
      >
        {trends === null ? (
          PANEL_FAILED
        ) : trends.length === 0 ? (
          <EmptyState bare title="No section has enough weekly attendance to compare yet" description={SUPPRESSED} />
        ) : (
          <ul className="max-h-96 space-y-1.5 overflow-auto">
            {trends.map((r) => (
              <li key={r.class_section_id} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                {r.is_break ? <Badge variant="destructive">Break</Badge> : <Badge variant="secondary">Steady</Badge>}
                <span>{trendBreakCaption(r)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
