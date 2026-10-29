import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { ApplicationDetail } from "@/modules/admissions/components/ApplicationDetail";
import { getApplication, listApplicationDecisions } from "@/modules/admissions/queries";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "admissions.enquiry.read");

  const application = await getApplication(ctx, id);
  if (!application) notFound();

  const decisions = await listApplicationDecisions(ctx, id);

  return (
    <ApplicationDetail
      institutionSlug={institutionSlug}
      application={application}
      decisions={decisions}
      canDecideApplication={hasPermission(ctx, "admissions.application.decide")}
    />
  );
}
