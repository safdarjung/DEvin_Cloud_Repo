import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { ListPager } from "@/components/list-pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { applicationStatusVariant } from "@/modules/admissions/status";
import { listApplicationsPage, type ApplicationRow } from "@/modules/admissions/queries";
import type { ApplicationStatus } from "@/modules/admissions/state";
import { humanize } from "@/lib/format";
import { parsePage } from "@/lib/list-search";

const STATUSES: ApplicationStatus[] = ["submitted", "under_review", "interaction_scheduled", "offered", "accepted", "rejected", "withdrawn", "enrolled"];

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { status: rawStatus, q, page } = await searchParams;
  const status = STATUSES.find((s) => s === rawStatus);
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "admissions");
  requirePermission(ctx, "admissions.enquiry.read");

  const pageNum = parsePage(page);
  const { rows: applications, total, pageSize } = await listApplicationsPage(ctx, { status, q, page: pageNum });

  return (
    <div className="space-y-4">
      <PageHeader title="Applications" back={{ href: `/${institutionSlug}/admissions`, label: "Pipeline" }} />
      <Card>
        <form method="get" className="flex flex-wrap items-center gap-2 border-b-2 border-border px-4 pb-3">
          <div className="relative w-full min-w-0 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q ?? ""} placeholder="Search by applicant name or application no" aria-label="Search applications" className="pl-9" />
          </div>
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label="Filter by status"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 text-sm sm:h-9 sm:flex-none"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          {applications.length === 0 ? (
            <EmptyState
              title={q ? "No applications match your search" : status ? `No applications in ${humanize(status)}` : "No applications yet"}
              description={q ? "Try a different name or application number." : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead className="hidden sm:table-cell">Application no</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => (
                  <ApplicationRowItem key={application.id} institutionSlug={institutionSlug} application={application} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ListPager basePath={`/${institutionSlug}/admissions/applications`} params={{ q, status }} page={pageNum} total={total} pageSize={pageSize} noun="applications" />
    </div>
  );
}

function ApplicationRowItem({ institutionSlug, application }: { institutionSlug: string; application: ApplicationRow }) {
  const applicant = application.applicant as { firstName?: string; lastName?: string };
  const name = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "Applicant";
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/${institutionSlug}/admissions/applications/${application.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {name}
        </Link>
      </TableCell>
      <TableCell className="hidden sm:table-cell">{application.applicationNo}</TableCell>
      <TableCell>
        <Badge variant={applicationStatusVariant(application.status)}>{humanize(application.status)}</Badge>
      </TableCell>
    </TableRow>
  );
}
