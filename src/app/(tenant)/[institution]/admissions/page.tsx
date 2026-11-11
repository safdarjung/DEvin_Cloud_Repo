import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList } from "@/components/widgets/viz";
import { humanize } from "@/lib/format";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { PipelineBoard } from "@/modules/admissions/components/PipelineBoard";
import { enquiryStagesFor, listEnquiriesByStage } from "@/modules/admissions/queries";

export const metadata: Metadata = { title: "Admissions" };

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
  const stageCounts = stages.map((stage) => ({ label: humanize(stage), value: byStage[stage]?.length ?? 0 }));
  const totalEnquiries = stageCounts.reduce((sum, s) => sum + s.value, 0);

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
      {totalEnquiries > 0 && (
        <FadeIn>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Enquiries by stage</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <BarList items={stageCounts} ariaLabel="Enquiries by stage" />
            </CardContent>
          </Card>
        </FadeIn>
      )}
      <PipelineBoard institutionSlug={institutionSlug} stages={stages} byStage={byStage} />
    </div>
  );
}
