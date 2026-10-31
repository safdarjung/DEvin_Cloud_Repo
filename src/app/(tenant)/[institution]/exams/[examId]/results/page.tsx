import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { verifyExam } from "@/modules/exams/actions";
import { humanize } from "@/lib/format";
import { PublishButton } from "@/modules/exams/components/PublishButton";
import { ResultsTable } from "@/modules/exams/components/ResultsTable";
import { getExamWithPapers, listResultsForExam } from "@/modules/exams/queries";

// T-019 — 06 §W7's one-click publish lives here: before publish this is the
// verification + PublishButton screen; after publish it's the class list
// (ResultsTable). `exam.result.read` is also held by guardian/student (07
// §2.2), who must never see a whole class's results — LIST_ROLES narrows
// this page to the roles the matrix actually gives a class-wide view to.
const LIST_ROLES = new Set(["owner", "principal", "admin", "exam_controller", "teacher"]);

export default async function ExamResultsPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string }>;
}) {
  const { institution: institutionSlug, examId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.result.read");
  if (!LIST_ROLES.has(ctx.membership.role)) notFound();

  const exam = await getExamWithPapers(ctx, examId);
  if (!exam) notFound();

  if (exam.status === "published") {
    const summary = await listResultsForExam(ctx, examId);
    if (!summary) notFound();
    return (
      <div className="space-y-6">
        <PageHeader title={`${exam.name} — Results`} description={exam.type} back={{ href: `/${institutionSlug}/exams/${examId}`, label: "Exam" }} />
        <ResultsTable institutionSlug={institutionSlug} examId={examId} summary={summary} />
      </div>
    );
  }

  if (exam.status !== "verification") {
    return (
      <div className="space-y-4">
        <PageHeader title={`${exam.name} — Results`} description={exam.type} back={{ href: `/${institutionSlug}/exams/${examId}`, label: "Exam" }} />
        <p className="text-sm text-muted-foreground">
          Results can be published once the exam is in verification. Current status: {humanize(exam.status)}.
        </p>
      </div>
    );
  }

  const verification = await verifyExam(institutionSlug, { examId });
  const clean = verification.ok ? verification.data.summary.clean : false;

  return (
    <div className="space-y-4">
      <PageHeader title={`${exam.name} — Results`} description={exam.type} back={{ href: `/${institutionSlug}/exams/${examId}`, label: "Exam" }} />
      {verification.ok && !clean && (
        <p role="alert" className="text-sm text-destructive">
          {verification.data.summary.missingCount} missing, {verification.data.summary.outOfRangeCount} out of range.
          Resolve on the exam page before publishing.
        </p>
      )}
      <Card>
        <CardContent>
          {ctx.permissions.has("exam.result.publish") ? (
            <PublishButton institutionSlug={institutionSlug} examId={examId} verificationClean={clean} />
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for an exam controller to publish.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
