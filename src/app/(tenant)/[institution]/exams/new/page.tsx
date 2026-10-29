import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { ExamForm } from "@/modules/exams/components/ExamForm";
import { listTermOptions } from "@/modules/exams/queries";

export default async function NewExamPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.manage");

  const terms = await listTermOptions(ctx);
  const examsSettings = InstitutionSettingsSchema.shape.exams.safeParse(ctx.institution.settings.exams);
  const gradingScaleKeys = examsSettings.success ? Object.keys(examsSettings.data.grading_scales) : ["default"];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New exam</h1>
      {terms.length === 0 ? (
        <p className="text-muted-foreground text-sm">No terms found for the current academic year.</p>
      ) : (
        <ExamForm institutionSlug={institutionSlug} terms={terms} gradingScaleKeys={gradingScaleKeys} />
      )}
    </div>
  );
}
