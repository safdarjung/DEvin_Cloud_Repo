import type { ComponentProps } from "react";
import { PageHeader } from "@/components/page-header";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { listAttentionJobs } from "@/modules/jobs/queries";
import { RequeueButton } from "./requeue-button";

type Variant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

// Row entrance: CSS only, `from`-state held during the delay, skipped under reduced motion.
const ROW_ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)";
const rowDelay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 25}ms` });

// jobs.status check: 20261028000003_platform.sql
function jobStatusVariant(status: string): Variant {
  switch (status) {
    case "succeeded":
      return "success";
    case "running":
      return "info";
    case "queued":
      return "warning";
    case "failed":
    case "dead":
      return "destructive";
    default:
      return "outline";
  }
}

export default async function JobsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "job.manage");

  const jobs = await listAttentionJobs(ctx);
  const deadCount = jobs.filter((j) => j.status === "dead").length;
  const retryingCount = jobs.filter((j) => j.status === "queued").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        description="Background jobs that failed at least once (06 §W12). Dead-lettered jobs can be requeued."
      />

      {jobs.length === 0 ? (
        <EmptyState title="No failed or dead-lettered jobs" />
      ) : (
        <>
        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StaggerItem className="min-w-0 motion-safe:fill-mode-backwards">
            <KpiTile label="Need attention" value={String(jobs.length)} animateTo={jobs.length} />
          </StaggerItem>
          <StaggerItem className="min-w-0 motion-safe:fill-mode-backwards">
            <KpiTile label="Dead-lettered" value={String(deadCount)} animateTo={deadCount} tone={deadCount > 0 ? "destructive" : "default"} sub="Can be requeued" />
          </StaggerItem>
          <StaggerItem className="min-w-0 motion-safe:fill-mode-backwards">
            <KpiTile label="Retrying" value={String(retryingCount)} animateTo={retryingCount} tone={retryingCount > 0 ? "warning" : "default"} sub="Queued again after a failure" />
          </StaggerItem>
        </Stagger>
        <Card>
          <CardContent className="min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Attempts</TableHead>
                  <TableHead className="hidden sm:table-cell">Last error</TableHead>
                  <TableHead className="hidden sm:table-cell">Updated</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job, i) => (
                  <TableRow key={job.id} className={ROW_ENTER} style={rowDelay(i)}>
                    <TableCell>
                      {job.type}
                      {job.lastError && <p className="mt-0.5 line-clamp-2 text-xs whitespace-normal text-muted-foreground sm:hidden">{job.lastError}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={jobStatusVariant(job.status)}>{humanize(job.status)}</Badge>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell
                      className="hidden max-w-xs truncate text-sm text-muted-foreground sm:table-cell"
                      title={job.lastError ?? ""}
                    >
                      {job.lastError}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{new Date(job.updatedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {job.status === "dead" ? <RequeueButton institutionSlug={institutionSlug} jobId={job.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
