import Link from "next/link";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { BarList, ProgressBar } from "@/components/widgets/viz";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { inr } from "@/lib/format";
import { currentTermCollections } from "@/modules/core/dashboard.queries";
import { FinanceIntelChart, type FinanceChartPoint } from "@/modules/fabric/components/finance-intel-chart";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { PlannedWidget, SimpleTable, StatusChip, loadSection, renderSection } from "@/modules/fabric/components/fabric-sections";
import { listDefaulters, listTermOptions } from "@/modules/finance/queries";
import { financeSeries, listForecasts } from "@/modules/forecasts/queries";

const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
function monthLabel(ym: string): string {
  return MONTH_FMT.format(new Date(`${ym}-01T00:00:00Z`));
}
const pct = (fraction: number, digits = 0): string => `${(fraction * 100).toFixed(digits)}%`;
const paiseToInr = (paise: number): string => inr(paise / 100);

export default async function FinanceIntelPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");
  requirePermission(ctx, "finance.read");
  const base = `/${institutionSlug}`;

  const [forecast, collections, defaulters] = await Promise.all([
    loadSection(ctx, "forecast", "forecast.read", "forecasts", async () => {
      const [series, rows] = await Promise.all([financeSeries(ctx), listForecasts(ctx, { kind: "fee_collections_term" })]);
      return { series, rows };
    }),
    loadSection(ctx, "collections", "finance.read", "fees", () => currentTermCollections(ctx)),
    loadSection(ctx, "defaulters", "finance.structure.manage", "fees", async () => {
      const terms = await listTermOptions(ctx);
      const term = terms[0];
      return term ? { term, rows: await listDefaulters(ctx, { termId: term.id }) } : null;
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  // Observed months only (forecast months excluded), oldest first, for the Collected tile.
  const observedSpark =
    forecast.state === "ok"
      ? (() => {
          const fc = new Set(forecast.data.rows.map((r) => r.periodStart.slice(0, 7)));
          return forecast.data.series.filter((p) => !fc.has(p.month)).map((p) => p.collected_paise / 100);
        })()
      : undefined;

  return (
    <FabricPage
      title="Finance intel"
      description="Observed collections, forecast, and outstanding fees from your own ledger."
      ws="finance-intel"
    >
      <div className="space-y-4">
        {collections.state === "ok" && collections.data && (
          <section aria-label="This term">
            <KpiStrip className="md:[&>div]:grid-cols-4 xl:[&>div]:grid-cols-4">
            <KpiTile label="Billed this term" value={paiseToInr(collections.data.duePaise)} animateTo={collections.data.duePaise / 100} format="inr" sub={`${collections.data.invoiceCount} invoices`} />
            <KpiTile label="Collected" value={paiseToInr(collections.data.collectedPaise)} animateTo={collections.data.collectedPaise / 100} format="inr" spark={observedSpark} />
            <KpiTile
              label="Outstanding"
              value={paiseToInr(Math.max(0, collections.data.duePaise - collections.data.collectedPaise))}
              animateTo={Math.max(0, collections.data.duePaise - collections.data.collectedPaise) / 100}
              format="inr"
            />
            <KpiTile
              label="Collected share"
              value={collections.data.duePaise > 0 ? pct(collections.data.collectedPaise / collections.data.duePaise) : "—"}
              sub="of billed"
            />
            </KpiStrip>
            {collections.data.duePaise > 0 && (
              <ProgressBar
                className="mt-3"
                label="Collected against billed this term"
                value={collections.data.collectedPaise}
                max={collections.data.duePaise}
                valueLabel={`${paiseToInr(collections.data.collectedPaise)} of ${paiseToInr(collections.data.duePaise)}`}
                tone="success"
              />
            )}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {renderSection(
            "Fee collections: observed and forecast",
            forecast,
            ({ series, rows }) => {
              if (series.length === 0) {
                return <p className="text-sm text-muted-foreground">No forecast has been generated for this school yet. Forecasts need several months of collection history.</p>;
              }
              const forecastMonths = new Set(rows.map((r) => r.periodStart.slice(0, 7)));
              const points = series.map((p) => ({ ...p, isForecast: forecastMonths.has(p.month) }));
              const chart: FinanceChartPoint[] = points.map((p) => ({
                label: monthLabel(p.month),
                observed: p.isForecast ? null : p.collected_paise / 100,
                forecast: p.isForecast ? p.expected_paise / 100 : null,
                band: p.isForecast ? [p.forecast_low_paise / 100, p.forecast_high_paise / 100] : null,
              }));
              const nObs = points.filter((p) => !p.isForecast).length;
              const nFc = points.length - nObs;
              const summary = `${nObs} months observed, ${nFc} months forecast. Forecast values and their ranges are in the table below.`;
              return (
                <div className="space-y-3">
                  <FinanceIntelChart data={chart} summary={summary} />
                  <SimpleTable
                    caption="Fee collections by month, observed and forecast"
                    head={["Month", "Type", "Collected / expected", "Range"]}
                    numericCols={[2, 3]}
                    rows={points.map((p) => ({
                      key: p.month,
                      cells: p.isForecast
                        ? [monthLabel(p.month), <StatusChip key="t" tone="warn">Forecast</StatusChip>, paiseToInr(p.expected_paise), `${paiseToInr(p.forecast_low_paise)} – ${paiseToInr(p.forecast_high_paise)}`]
                        : [monthLabel(p.month), <StatusChip key="t">Observed</StatusChip>, paiseToInr(p.collected_paise), "—"],
                    }))}
                  />
                </div>
              );
            },
            { description: "Bars are money received. The dashed line and shaded range are a statistical forecast, not a promise.", className: "lg:col-span-2" },
          )}

          {forecast.state === "ok" &&
            forecast.data.rows.length > 0 &&
            renderSection(
              "Forecast assumptions",
              forecast,
              ({ rows }) => (
                <div className="space-y-2">
                  <SimpleTable
                    caption="Forecast confidence and backtest error"
                    head={["Period", "Model", "Confidence", "Backtest error", "Months of history"]}
                    numericCols={[2, 3, 4]}
                    rows={rows.map((r) => ({
                      key: `${r.seriesKey}:${r.horizon}`,
                      cells: [r.periodLabel, r.model, pct(r.confidence), r.mape > 0 ? pct(r.mape, 1) : "—", r.nTrain || "—"],
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Backtest error is how far the model was from actual collections on held-out past months. Lower is better. Forecast generated {rows[0]?.asOf.slice(0, 10)}.
                  </p>
                </div>
              ),
              { description: "How much to trust the forecast", className: "lg:col-span-2" },
            )}

          {renderSection(
            "Outstanding fees",
            defaulters,
            (d) => {
              if (!d) return <p className="text-sm text-muted-foreground">No terms are set up for the current academic year.</p>;
              if (d.rows.length === 0) return <p className="text-sm text-muted-foreground">No unpaid invoices for {d.term.label}.</p>;
              const total = d.rows.reduce((s, r) => s + Math.round(r.outstanding * 100), 0) / 100;
              const top = [...d.rows].sort((a, b) => b.outstanding - a.outstanding).slice(0, 8);
              return (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium tabular-nums">{inr(total)}</span> outstanding across {d.rows.length} invoices in {d.term.label}.
                  </p>
                  <BarList
                    ariaLabel={`Largest outstanding invoices, ${d.term.label}`}
                    format="inr"
                    items={top.slice(0, 5).map((r) => ({ label: r.studentName, value: r.outstanding, tone: r.dueOn !== null && r.dueOn < today ? ("destructive" as const) : ("warning" as const) }))}
                  />
                  <SimpleTable
                    caption={`Largest outstanding invoices, ${d.term.label}`}
                    head={["Student", "Outstanding", "Due"]}
                    numericCols={[1]}
                    rows={top.map((r) => {
                      const overdue = r.dueOn !== null && r.dueOn < today;
                      return {
                        key: r.invoiceId,
                        cells: [r.studentName, inr(r.outstanding), r.dueOn ? <>{r.dueOn}{overdue && <StatusChip tone="bad"> Overdue</StatusChip>}</> : "No due date"],
                      };
                    })}
                  />
                  <p className="text-xs text-muted-foreground">Showing the 8 largest of {d.rows.length}.</p>
                </div>
              );
            },
            { description: "Unpaid and part-paid invoices, current term", action: { href: `${base}/finance/defaulters`, label: "All defaulters" } },
          )}

          <PlannedWidget title="Budget vs actual" note="Budgets are not tracked yet, so no variance is shown." />
          <PlannedWidget title="Late-fee rules" note="Automatic late fees are not available yet." />
        </div>

        {forecast.state === "ok" && (
          <p className="text-xs text-muted-foreground">
            Forecasts use this school&apos;s own history only. Open the <Link className="underline" href={`${base}/finance`}>finance records</Link> for ledger detail.
          </p>
        )}
      </div>
    </FabricPage>
  );
}
