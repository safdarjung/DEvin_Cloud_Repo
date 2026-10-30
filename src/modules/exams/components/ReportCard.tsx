// T-019 — server component, exported for the guardian/student portal
// (T-034) and the student profile (T-028), same shape as
// StudentAttendanceSummary.tsx: it runs the query itself from `ctx` and
// renders already-computed numbers, never recomputing a grade on read
// (rule 3 — the grade label is always `results.grade` from the snapshot).
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { RecheckRequestForm } from "@/modules/exams/components/RecheckRequestForm";
import { getCurrentResult, getResultRemark, listRechecksForResult } from "@/modules/exams/queries";

interface ReportCardProps {
  ctx: TenantContext;
  examId: string;
  studentId: string;
}

/** Human label for a recheck's status, shown in place of the "Request recheck" button once one exists for a paper. */
const RECHECK_STATUS_LABEL: Record<string, string> = {
  submitted: "Recheck: submitted",
  under_review: "Recheck: under review",
  approved: "Recheck: approved",
  rejected: "Recheck: rejected",
  applied: "Recheck: applied",
};

/** Renders nothing (null) when there is no current result for this exam/student — RLS and/or publish state, left to the caller to turn into a notFound(). */
export async function ReportCard({ ctx, examId, studentId }: ReportCardProps) {
  const result = await getCurrentResult(ctx, examId, studentId);
  if (!result) return null;

  // Only guardians/students may request a recheck (07 §2.2 exam.recheck.
  // request) — staff viewing the same ReportCard (exam detail/results pages)
  // never see this affordance, since they file on behalf through the queue
  // instead (06 §W8 failure/retry note).
  const canRequestRecheck = hasPermission(ctx, "exam.recheck.request");
  const rechecksByPaper = canRequestRecheck
    ? new Map((await listRechecksForResult(ctx, result.id)).map((r) => [r.examPaperId, r]))
    : null;

  // A human (teacher/controller) already reviewed and saved this remark
  // (RemarkDraftEditor's "AI draft — review before saving" step) before it
  // ever reaches here, so it renders plainly — no AI/draft language on this
  // component, which both the staff page and the guardian/student portal share.
  const remark = await getResultRemark(ctx, result.id);

  return (
    <Card className="print:shadow-none" data-testid="report-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <span>
            {result.studentName} — {result.examName}
          </span>
          <Badge variant={result.grade.startsWith("E") ? "destructive" : "secondary"}>{result.grade}</Badge>
        </CardTitle>
        <p className="text-muted-foreground text-sm">Admission No. {result.admissionNo}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.isCorrected && (
          <p className="text-muted-foreground text-sm" role="note">
            Corrected on {new Date(result.publishedAt).toLocaleDateString()}
          </p>
        )}

        <table className="w-full text-sm print:text-xs">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1 font-medium">Subject</th>
              <th className="py-1 text-right font-medium">Marks</th>
              <th className="py-1 text-right font-medium">Max</th>
              <th className="py-1 text-right font-medium">Grade</th>
              {canRequestRecheck && <th className="py-1 text-right font-medium print:hidden">Recheck</th>}
            </tr>
          </thead>
          <tbody>
            {result.subjects.map((subject) => {
              const recheck = rechecksByPaper?.get(subject.examPaperId) ?? null;
              return (
                <tr key={subject.examPaperId} className="border-b border-border/50">
                  <td className="py-1">{subject.subjectName}</td>
                  <td className="py-1 text-right">{subject.isAbsent ? "Absent" : subject.marksObtained}</td>
                  <td className="py-1 text-right">{subject.maxMarks}</td>
                  <td className="py-1 text-right">{subject.grade ?? "—"}</td>
                  {canRequestRecheck && (
                    <td className="py-1 text-right print:hidden">
                      {recheck ? (
                        <span className="text-muted-foreground text-xs">
                          {RECHECK_STATUS_LABEL[recheck.status] ?? recheck.status}
                        </span>
                      ) : (
                        <RecheckRequestForm
                          institutionSlug={ctx.institution.slug}
                          resultId={result.id}
                          examPaperId={subject.examPaperId}
                          subjectName={subject.subjectName}
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1">Total</td>
              <td className="py-1 text-right">{result.total}</td>
              <td className="py-1 text-right">{result.maxTotal}</td>
              <td className="py-1 text-right">{result.grade}</td>
              {canRequestRecheck && <td className="print:hidden" />}
            </tr>
          </tfoot>
        </table>

        <div className="flex items-center justify-between text-sm">
          <span>Percentage: {result.percentage}%</span>
          <span>Attendance: {result.attendancePercentage}%</span>
        </div>

        {remark && <p className="text-sm italic">{remark}</p>}
      </CardContent>
    </Card>
  );
}
