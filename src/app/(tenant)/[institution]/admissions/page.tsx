import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { PipelineBoard } from "@/modules/admissions/components/PipelineBoard";
import { enquiryStagesFor, listEnquiriesByStage } from "@/modules/admissions/queries";

export default async function AdmissionsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "admissions");
  requirePermission(ctx, "admissions.enquiry.read");

  const stages = enquiryStagesFor(ctx);
  const byStage = await listEnquiriesByStage(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admissions pipeline"
        description="Enquiries grouped by stage. Change a card's stage from its dropdown."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/${institutionSlug}/admissions/applications`}>Applications</Link>
          </Button>
        }
      />
      <PipelineBoard institutionSlug={institutionSlug} stages={stages} byStage={byStage} />
    </div>
  );
}
