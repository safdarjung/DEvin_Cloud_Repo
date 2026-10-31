import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { examStatusLabel, recheckStatusVariant } from "@/modules/exams/components/ResultsTable";
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
      <PageHeader
        title={`${request.studentName} — ${request.subjectName}`}
        description={request.examName}
        back={{ href: `/${institutionSlug}/exams/rechecks`, label: "Recheck requests" }}
        actions={<Badge variant={recheckStatusVariant(request.status)}>{examStatusLabel(request.status)}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Reason</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{request.reason}</p>
        </CardContent>
      </Card>

      <RecheckDecisionForm institutionSlug={institutionSlug} request={request} />

      <ResultVersionHistory history={history} />
    </div>
  );
}
