import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { listAttentionJobs } from "@/modules/jobs/queries";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RequeueButton } from "./requeue-button";

export default async function JobsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "job.manage");

  const jobs = await listAttentionJobs(ctx);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Jobs</h1>
        <p className="text-muted-foreground text-sm">
          Background jobs that failed at least once (06 §W12). Dead-lettered jobs can be requeued.
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No failed or dead-lettered jobs.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>{job.type}</TableCell>
                <TableCell>
                  <Badge variant={job.status === "dead" ? "destructive" : "secondary"}>{job.status}</Badge>
                </TableCell>
                <TableCell>
                  {job.attempts}/{job.maxAttempts}
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={job.lastError ?? ""}>
                  {job.lastError}
                </TableCell>
                <TableCell>{new Date(job.updatedAt).toLocaleString()}</TableCell>
                <TableCell>
                  {job.status === "dead" ? (
                    <RequeueButton institutionSlug={institutionSlug} jobId={job.id} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
