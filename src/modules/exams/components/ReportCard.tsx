// T-019 — server component, exported for the guardian/student portal
// (T-034) and the student profile (T-028), same shape as
// StudentAttendanceSummary.tsx: it runs the query itself from `ctx` and
// renders already-computed numbers, never recomputing a grade on read
// (rule 3 — the grade label is always `results.grade` from the snapshot).
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantContext } from "@/lib/auth/types";
import { getCurrentResult } from "@/modules/exams/queries";

interface ReportCardProps {
  ctx: TenantContext;
  examId: string;
  studentId: string;
}

/** Renders nothing (null) when there is no current result for this exam/student — RLS and/or publish state, left to the caller to turn into a notFound(). */
export async function ReportCard({ ctx, examId, studentId }: ReportCardProps) {
  const result = await getCurrentResult(ctx, examId, studentId);
  if (!result) return null;

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
            </tr>
          </thead>
          <tbody>
            {result.subjects.map((subject) => (
              <tr key={subject.examPaperId} className="border-b border-border/50">
                <td className="py-1">{subject.subjectName}</td>
                <td className="py-1 text-right">{subject.isAbsent ? "Absent" : subject.marksObtained}</td>
                <td className="py-1 text-right">{subject.maxMarks}</td>
                <td className="py-1 text-right">{subject.grade ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1">Total</td>
              <td className="py-1 text-right">{result.total}</td>
              <td className="py-1 text-right">{result.maxTotal}</td>
              <td className="py-1 text-right">{result.grade}</td>
            </tr>
          </tfoot>
        </table>

        <div className="flex items-center justify-between text-sm">
          <span>Percentage: {result.percentage}%</span>
          <span>Attendance: {result.attendancePercentage}%</span>
        </div>
      </CardContent>
    </Card>
  );
}
