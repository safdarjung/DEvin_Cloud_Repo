import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { applicationStatusVariant } from "@/modules/admissions/status";
import { listApplications, type ApplicationRow } from "@/modules/admissions/queries";
import type { ApplicationStatus } from "@/modules/admissions/state";
import { humanize } from "@/lib/format";

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { status } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "admissions.enquiry.read");

  const applications = await listApplications(ctx, status as ApplicationStatus | undefined);

  return (
    <div className="space-y-4">
      <PageHeader title="Applications" />
      {applications.length === 0 ? (
        <EmptyState title={status ? `No applications in ${humanize(status)}` : "No applications yet"} />
      ) : (
        <Card>
          <CardContent>
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
          </CardContent>
        </Card>
      )}
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
