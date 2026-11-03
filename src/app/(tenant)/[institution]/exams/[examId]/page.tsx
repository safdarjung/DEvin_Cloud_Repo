import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { PaperGrid } from "@/modules/exams/components/PaperGrid";
import { VerificationPanel } from "@/modules/exams/components/VerificationPanel";
import { getExamWithPapers, listSectionOptions, listSubjectOptions } from "@/modules/exams/queries";
import { verifyExam } from "@/modules/exams/actions";

// T-019 fix round 1 — same roles results/page.tsx (T-019) allows to see a
// whole class's results; guardian/student hold exam.result.read too but
// must never see this link (they get only their own report card, never a
// class list).
const RESULTS_LINK_ROLES = new Set(["owner", "principal", "admin", "exam_controller", "teacher"]);

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string }>;
}) {
  const { institution: institutionSlug, examId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.manage");

  const exam = await getExamWithPapers(ctx, examId);
  if (!exam) notFound();

  const verification = exam.papers.length > 0 ? await verifyExam(institutionSlug, { examId }) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={exam.name}
        description={`${exam.type} · ${exam.papers.length} paper${exam.papers.length === 1 ? "" : "s"}`}
        back={{ href: `/${institutionSlug}/exams`, label: "Exams" }}
        actions={
          ctx.permissions.has("exam.result.read") && RESULTS_LINK_ROLES.has(ctx.membership.role) ? (
            <Button asChild variant="outline">
              <Link href={`/${institutionSlug}/exams/${exam.id}/results`}>Publish / View results</Link>
            </Button>
          ) : undefined
        }
      />

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
        <Card>
          <CardHeader>
            <CardTitle>Papers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {exam.papers.map((paper) => (
                <li key={paper.id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/${institutionSlug}/exams/${exam.id}/papers/${paper.id}`} className="hover:underline">
                    {paper.sectionLabel} · {paper.subjectName}
                  </Link>
                  <span className="text-sm text-muted-foreground">/{paper.maxMarks}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Add papers</CardTitle>
      </CardHeader>
      <CardContent>
      <PaperGrid
        institutionSlug={institutionSlug}
        examId={examId}
        sections={sections}
        subjects={subjects}
        defaultMaxMarks={80}
        defaultPassPercentage={defaultPassPercentage}
      />
      </CardContent>
    </Card>
  );
}
