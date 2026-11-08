import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { ExamForm } from "@/modules/exams/components/ExamForm";
import { listTermOptions } from "@/modules/exams/queries";
import { FadeIn } from "@/components/motion";

export default async function NewExamPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.manage");

  const terms = await listTermOptions(ctx);
  const examsSettings = InstitutionSettingsSchema.shape.exams.safeParse(ctx.institution.settings.exams);
  const gradingScaleKeys = examsSettings.success ? Object.keys(examsSettings.data.grading_scales) : ["default"];

  return (
    <div className="space-y-4">
      <PageHeader title="New exam" back={{ href: `/${institutionSlug}/exams`, label: "Exams" }} />
      {terms.length === 0 ? (
        <EmptyState title="No terms found" description="No terms found for the current academic year." />
      ) : (
        <FadeIn>
          <ExamForm institutionSlug={institutionSlug} terms={terms} gradingScaleKeys={gradingScaleKeys} />
        </FadeIn>
      )}
    </div>
  );
}
