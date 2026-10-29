import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { PipelineBoard } from "@/modules/admissions/components/PipelineBoard";
import { enquiryStagesFor, listEnquiriesByStage } from "@/modules/admissions/queries";

export default async function AdmissionsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "admissions.enquiry.read");

  const stages = enquiryStagesFor(ctx);
  const byStage = await listEnquiriesByStage(ctx);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admissions pipeline</h1>
        <Link href={`/${institutionSlug}/admissions/applications`} className="text-primary text-sm underline-offset-2 hover:underline">
          Applications
        </Link>
      </div>
      <PipelineBoard institutionSlug={institutionSlug} stages={stages} byStage={byStage} />
    </div>
  );
}
