import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { verifyExam } from "@/modules/exams/actions";
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
        <header>
          <h1 className="text-xl font-semibold">{exam.name} — Results</h1>
          <p className="text-muted-foreground text-sm">{exam.type}</p>
        </header>
        <ResultsTable institutionSlug={institutionSlug} examId={examId} summary={summary} />
      </div>
    );
  }

  if (exam.status !== "verification") {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{exam.name} — Results</h1>
        <p className="text-muted-foreground text-sm">
          Results can be published once the exam is in verification. Current status: {exam.status}.
        </p>
      </div>
    );
  }

  const verification = await verifyExam(institutionSlug, { examId });
  const clean = verification.ok ? verification.data.summary.clean : false;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{exam.name} — Results</h1>
        <p className="text-muted-foreground text-sm">{exam.type}</p>
      </header>
      {verification.ok && !clean && (
        <p className="text-destructive text-sm">
          {verification.data.summary.missingCount} missing, {verification.data.summary.outOfRangeCount} out of range.
          Resolve on the exam page before publishing.
        </p>
      )}
      {ctx.permissions.has("exam.result.publish") ? (
        <PublishButton institutionSlug={institutionSlug} examId={examId} verificationClean={clean} />
      ) : (
        <p className="text-muted-foreground text-sm">Waiting for an exam controller to publish.</p>
      )}
    </div>
  );
}
