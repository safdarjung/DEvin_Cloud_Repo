import type { Metadata } from "next";
import { SimulatedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { PlannedWidget, SimpleTable, StatusChip, loadSection, renderSection } from "@/modules/fabric/components/fabric-sections";
import { getImportBatch } from "@/modules/imports/queries";
import { listAttentionJobs } from "@/modules/jobs/queries";
import { resendConfigured } from "@/modules/notifications/channels/resend";
import { whatsappConfigured } from "@/modules/notifications/channels/whatsapp";
import { reportList } from "@/modules/reports/queries";

export const metadata: Metadata = { title: "Data & integrations" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DataPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
}) {
  const { institution: institutionSlug } = await params;
  const { batch } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const batchRaw = typeof batch === "string" ? batch.trim() : "";
  const batchId = UUID_RE.test(batchRaw) ? batchRaw : undefined;
  const canImport = hasPermission(ctx, "data.import");
  const canChannels = hasPermission(ctx, "notification.log.read");

  const [importBatch, jobs, reports] = await Promise.all([
    batchId ? loadSection(ctx, "import batch", "data.import", null, () => getImportBatch(ctx, batchId)) : Promise.resolve(null),
    loadSection(ctx, "jobs", "job.manage", null, () => listAttentionJobs(ctx)),
    loadSection(ctx, "scheduled reports", "report.schedule", "scheduled_reports", () => reportList(ctx)),
  ]);

  const channels = [
    { name: "In-app", simulated: false, note: "Delivered inside CoolSkool." },
    { name: "SMS", simulated: true, note: "No SMS provider is connected. Messages are logged, not delivered." },
    ctx.institution.is_demo
      ? { name: "WhatsApp", simulated: true, note: "Demo school: always simulated." }
      : whatsappConfigured()
        ? { name: "WhatsApp", simulated: false, note: "Provider keys are configured." }
        : { name: "WhatsApp", simulated: true, note: "Simulated until provider keys are configured." },
    resendConfigured()
      ? { name: "Email", simulated: false, note: "Provider key is configured." }
      : { name: "Email", simulated: true, note: "Simulated until a provider key is configured." },
  ];

  return (
    <FabricPage title="Data" description="Imports, scheduled reports, background jobs and message channels." ws="data">
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {canImport && (
            <Widget title="Import batch" description="Check the result of a data import by its batch id.">
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="batch" className="mb-1 block">Batch id</Label>
                  <Input id="batch" name="batch" defaultValue={batch ?? ""} placeholder="00000000-0000-0000-0000-000000000000" aria-describedby="batch-help" />
                </div>
                <Button type="submit" variant="outline" className="w-full sm:w-auto">Look up</Button>
              </form>
              <p id="batch-help" className="mt-2 text-xs text-muted-foreground">Batch ids are shown when an import finishes. There is no import history list yet.</p>
              {batch && !batchId && <p role="alert" className="mt-2 text-sm text-destructive">That is not a valid batch id.</p>}
              {importBatch &&
                renderSection(
                  "Batch result",
                  importBatch,
                  (b) => (
                    <div className="space-y-2">
                      <p className="text-sm">
                        {humanize(b.entityType)} · {b.fileName} · <StatusChip>{humanize(b.status)}</StatusChip>
                      </p>
                      {b.rowCount > 0 && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ProgressBar label="Valid rows" value={b.validCount} max={b.rowCount} valueLabel={`${b.validCount} of ${b.rowCount}`} tone={b.errorCount > 0 ? "warning" : "success"} />
                          <ProgressBar label="Committed rows" value={b.committedCount} max={b.rowCount} valueLabel={`${b.committedCount} of ${b.rowCount}`} tone="success" />
                        </div>
                      )}
                      <SimpleTable
                        caption="Import batch row counts"
                        head={["Rows", "Valid", "Errors", "Committed", "Skipped"]}
                        numericCols={[0, 1, 2, 3, 4]}
                        rows={[{ key: b.id, cells: [b.rowCount, b.validCount, b.errorCount, b.committedCount, b.skippedCount] }]}
                      />
                      {b.invalidRows.length > 0 && (
                        <SimpleTable
                          caption="Rows with errors"
                          head={["Row", "Problems"]}
                          numericCols={[0]}
                          rows={b.invalidRows.slice(0, 20).map((r) => ({
                            key: String(r.rowNo),
                            cells: [r.rowNo, r.errors ? Object.entries(r.errors).map(([f, m]) => `${f}: ${m.join(", ")}`).join("; ") : "—"],
                          }))}
                        />
                      )}
                    </div>
                  ),
                )}
            </Widget>
          )}

          {renderSection(
            "Jobs needing attention",
            jobs,
            (rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failed or retrying jobs.</p>
              ) : (
                <SimpleTable
                  caption="Failed or retrying background jobs"
                  head={["Job", "State", "Attempts", "Last error"]}
                  numericCols={[2]}
                  rows={rows.slice(0, 15).map((j) => ({
                    key: j.id,
                    cells: [humanize(j.type), <StatusChip key="s" tone={j.status === "dead" ? "bad" : "warn"}>{j.status === "dead" ? "Dead-lettered" : "Retrying"}</StatusChip>, `${j.attempts} / ${j.maxAttempts}`, j.lastError ? "Error recorded (see Jobs)" : "—"],
                  }))}
                />
              ),
            { description: "Re-queue from the jobs page", action: { href: `/${institutionSlug}/jobs`, label: "Jobs" } },
          )}

          {renderSection(
            "Scheduled reports",
            reports,
            (rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reports are scheduled.</p>
              ) : (
                <SimpleTable
                  caption="Scheduled reports"
                  head={["Report", "Source", "Status", "Next run"]}
                  rows={rows.map((r) => ({
                    key: r.id,
                    cells: [r.name, r.source, <StatusChip key="s" tone={r.status === "active" ? "good" : "neutral"}>{humanize(r.status)}</StatusChip>, r.nextRunAt ? r.nextRunAt.slice(0, 16).replace("T", " ") + " UTC" : "—"],
                  }))}
                />
              ),
            { description: hasPermission(ctx, "data.export") ? "You can export report data." : "Exporting needs the data export permission." },
          )}

          {canChannels && (
            <Widget title="Message channels" description="Which channels really deliver.">
              <ul className="space-y-2">
                {channels.map((c) => (
                  <li key={c.name} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{c.name}</span>
                    {c.simulated ? <SimulatedBadge /> : <StatusChip tone="good">Live</StatusChip>}
                    <span className="text-muted-foreground">{c.note}</span>
                  </li>
                ))}
              </ul>
            </Widget>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PlannedWidget title="Connectors" note="Outside systems cannot be linked yet." />
          <PlannedWidget title="Data lineage" note="Where each figure came from is not traced yet." />
        </div>
      </div>
    </FabricPage>
  );
}
