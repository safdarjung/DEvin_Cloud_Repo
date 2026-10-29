import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { PaperGrid } from "@/modules/exams/components/PaperGrid";
import { VerificationPanel } from "@/modules/exams/components/VerificationPanel";
import { getExamWithPapers, listSectionOptions, listSubjectOptions } from "@/modules/exams/queries";
import { verifyExam } from "@/modules/exams/actions";

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string }>;
}) {
  const { institution: institutionSlug, examId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.manage");

  const exam = await getExamWithPapers(ctx, examId);
  if (!exam) notFound();

  const verification = exam.papers.length > 0 ? await verifyExam(institutionSlug, { examId }) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{exam.name}</h1>
        <p className="text-muted-foreground text-sm">
          {exam.type} · {exam.papers.length} paper{exam.papers.length === 1 ? "" : "s"}
        </p>
      </div>

      <VerificationPanel
        institutionSlug={institutionSlug}
        examId={exam.id}
        examStatus={exam.status}
        hasPapers={exam.papers.length > 0}
        initialVerification={verification?.ok ? verification.data : null}
      />

      {exam.papers.length === 0 ? (
        <PaperGridSection ctx={ctx} examId={exam.id} institutionSlug={institutionSlug} />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Papers</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {exam.papers.map((paper) => (
              <li key={paper.id} className="flex items-center justify-between p-3">
                <Link href={`/${institutionSlug}/exams/${exam.id}/papers/${paper.id}`} className="hover:underline">
                  {paper.sectionLabel} · {paper.subjectName}
                </Link>
                <span className="text-muted-foreground text-sm">/{paper.maxMarks}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function PaperGridSection({
  ctx,
  examId,
  institutionSlug,
}: {
  ctx: Awaited<ReturnType<typeof getTenantContext>>;
  examId: string;
  institutionSlug: string;
}) {
  const [sections, subjects] = await Promise.all([listSectionOptions(ctx), listSubjectOptions(ctx)]);
  const examsSettings = InstitutionSettingsSchema.shape.exams.safeParse(ctx.institution.settings.exams);
  const defaultPassPercentage = examsSettings.success ? examsSettings.data.pass_percentage : 33;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Add papers</h2>
      <PaperGrid
        institutionSlug={institutionSlug}
        examId={examId}
        sections={sections}
        subjects={subjects}
        defaultMaxMarks={80}
        defaultPassPercentage={defaultPassPercentage}
      />
    </div>
  );
}
