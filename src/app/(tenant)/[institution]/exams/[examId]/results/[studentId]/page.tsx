import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { canDraftRemarkForResult } from "@/modules/ai/remark-scope";
import { ReportCard } from "@/modules/exams/components/ReportCard";
import { RemarkDraftEditor } from "@/modules/exams/components/RemarkDraftEditor";
import { ResultVersionHistory } from "@/modules/exams/components/ResultVersionHistory";
import { getCurrentResult, getResultHistory, getResultRemark } from "@/modules/exams/queries";

export const metadata: Metadata = { title: "Student result" };

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
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.result.read");

  const current = await getCurrentResult(ctx, examId, studentId);
  if (!current) notFound();

  const history = await getResultHistory(ctx, examId, studentId);

  // Staff-editing view only (CLAUDE.md rule 7) — the guardian/student
  // report card (ReportCard.tsx, reused by the portal) never shows this
  // button; it only renders the saved remark plainly once reviewed.
  let canDraftRemark = hasPermission(ctx, "exam.marks.enter");
  if (canDraftRemark) {
    const supabase = await createClient();
    canDraftRemark = await canDraftRemarkForResult(supabase, ctx, studentId);
  }
  const initialRemark = canDraftRemark ? await getResultRemark(ctx, current.id) : null;

  return (
    <div className="space-y-6 print:space-y-4">
      <ReportCard ctx={ctx} examId={examId} studentId={studentId} />
      {canDraftRemark && (
        <RemarkDraftEditor
          institutionSlug={institutionSlug}
          resultId={current.id}
          studentName={current.studentName}
          initialRemark={initialRemark}
          aiPolicy={ctx.institution.ai_policy}
        />
      )}
      <ResultVersionHistory history={history} />
    </div>
  );
}
