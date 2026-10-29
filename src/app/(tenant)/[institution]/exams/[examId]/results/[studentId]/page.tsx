import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { ReportCard } from "@/modules/exams/components/ReportCard";
import { ResultVersionHistory } from "@/modules/exams/components/ResultVersionHistory";
import { getCurrentResult, getResultHistory } from "@/modules/exams/queries";

// T-019 — one student's report card. `getCurrentResult` is pure RLS scope
// (0009 results_select): a guardian/student requesting another student's
// id gets no row here, so this returns not_found (AC3) rather than leaking
// existence. Version history (rule 3) is fetched separately and is `null`
// for anyone outside app.exam_roles(), checked server-side by
// getResultHistory itself, not just withheld in this page.
export default async function StudentReportCardPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string; studentId: string }>;
}) {
  const { institution: institutionSlug, examId, studentId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.result.read");

  const current = await getCurrentResult(ctx, examId, studentId);
  if (!current) notFound();

  const history = await getResultHistory(ctx, examId, studentId);

  return (
    <div className="space-y-6 print:space-y-4">
      <ReportCard ctx={ctx} examId={examId} studentId={studentId} />
      <ResultVersionHistory history={history} />
    </div>
  );
}
