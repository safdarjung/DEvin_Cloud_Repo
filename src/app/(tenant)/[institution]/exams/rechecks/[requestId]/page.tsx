import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { RecheckDecisionForm } from "@/modules/exams/components/RecheckDecisionForm";
import { ResultVersionHistory } from "@/modules/exams/components/ResultVersionHistory";
import { getRecheck, getResultHistory } from "@/modules/exams/queries";

// T-020 — review + decide one recheck request (06 §W8), exam.recheck.review
// only (decide_recheck itself re-checks exam.recheck.decide — RecheckDecisionForm
// renders the same "start review" / "decide" UI to anyone who can reach this
// page; the RPC is the real gate, same shape as PublishButton).
export default async function RecheckDecisionPage({
  params,
}: {
  params: Promise<{ institution: string; requestId: string }>;
}) {
  const { institution: institutionSlug, requestId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.recheck.review");

  const request = await getRecheck(ctx, requestId);
  if (!request) notFound();

  const history = await getResultHistory(ctx, request.examId, request.studentId);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {request.studentName} — {request.subjectName}
        </h1>
        <p className="text-muted-foreground text-sm">{request.examName}</p>
      </div>

      <div>
        <h2 className="text-sm font-medium">Reason</h2>
        <p className="text-sm">{request.reason}</p>
      </div>

      <RecheckDecisionForm institutionSlug={institutionSlug} request={request} />

      <ResultVersionHistory history={history} />
    </div>
  );
}
