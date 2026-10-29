// T-015 — server component, exported for the guardian/student portal and
// the staff student profile (06 §W5, AC5). Pure rendering over
// getStudentAttendanceSummary's already-computed numbers.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantContext } from "@/lib/auth/types";
import { getStudentAttendanceSummary } from "@/modules/attendance/queries";

interface StudentAttendanceSummaryProps {
  ctx: TenantContext;
  studentId: string;
  termId: string;
  studentName?: string;
}

export async function StudentAttendanceSummary({ ctx, studentId, termId, studentName }: StudentAttendanceSummaryProps) {
  const summary = await getStudentAttendanceSummary(ctx, studentId, termId);
  const isCritical = summary.percentage < summary.thresholds.critical;
  const isWarn = !isCritical && summary.percentage < summary.thresholds.warn;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{studentName ? `${studentName} — Attendance` : "Attendance"}</span>
          {(isCritical || isWarn) && <Badge variant={isCritical ? "destructive" : "secondary"}>{isCritical ? "Critical" : "Low"}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{summary.percentage.toFixed(2)}%</p>
        <p className="text-muted-foreground text-sm">
          {summary.presentWeighted} / {summary.totalInDenominator} days this term
        </p>
      </CardContent>
    </Card>
  );
}
