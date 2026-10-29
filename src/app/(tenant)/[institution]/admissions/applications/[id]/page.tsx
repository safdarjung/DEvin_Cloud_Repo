import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { ApplicationDetail } from "@/modules/admissions/components/ApplicationDetail";
import { getApplication, listApplicationDecisions, listSectionsForGrade } from "@/modules/admissions/queries";
import { listFeeStructures } from "@/modules/finance/queries";

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
  const canEnrol = hasPermission(ctx, "admissions.enrol") && application.status === "accepted";

  // T-028 — picker data only needed on an `accepted` application a caller
  // may actually enrol; skip the extra reads otherwise.
  const [sections, feeStructures] = canEnrol
    ? await Promise.all([
        listSectionsForGrade(ctx, application.gradeAppliedId, application.academicYearId),
        listFeeStructures(ctx, { academicYearId: application.academicYearId, gradeId: application.gradeAppliedId }),
      ])
    : [[], []];

  return (
    <ApplicationDetail
      institutionSlug={institutionSlug}
      application={application}
      decisions={decisions}
      canDecideApplication={hasPermission(ctx, "admissions.application.decide")}
      canEnrol={canEnrol}
      sections={sections}
      feeStructures={feeStructures}
    />
  );
}
