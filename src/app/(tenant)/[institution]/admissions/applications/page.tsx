import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { listApplications, type ApplicationRow } from "@/modules/admissions/queries";
import type { ApplicationStatus } from "@/modules/admissions/state";

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
      <h1 className="text-xl font-semibold">Applications</h1>
      {applications.length === 0 ? (
        <p className="text-muted-foreground text-sm">No applications{status ? ` in status "${status}"` : ""}.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {applications.map((application) => (
            <ApplicationRowItem key={application.id} institutionSlug={institutionSlug} application={application} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApplicationRowItem({ institutionSlug, application }: { institutionSlug: string; application: ApplicationRow }) {
  const applicant = application.applicant as { firstName?: string; lastName?: string };
  const name = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "Applicant";
  return (
    <li className="flex items-center justify-between p-3">
      <div>
        <Link
          href={`/${institutionSlug}/admissions/applications/${application.id}`}
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          {name}
        </Link>
        <p className="text-muted-foreground text-xs">{application.applicationNo}</p>
      </div>
      <span className="text-muted-foreground text-xs">{application.status}</span>
    </li>
  );
}
