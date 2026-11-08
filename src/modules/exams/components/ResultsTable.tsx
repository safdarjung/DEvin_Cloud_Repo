// T-019 — controller/teacher results list with a grade distribution
// summary (also used by T-039). Server component: the rows and
// distribution are already computed by listResultsForExam (RLS-scoped);
// this only renders them. Links each row to the per-student report card.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { BarList, RadialGauge } from "@/components/widgets/viz";
import { EmptyState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExamResultsSummary } from "@/modules/exams/queries";

interface ResultsTableProps {
  institutionSlug: string;
  examId: string;
  summary: ExamResultsSummary;
}

export function ResultsTable({ institutionSlug, examId, summary }: ResultsTableProps) {
  const distributionEntries = Object.entries(summary.gradeDistribution).sort(([a], [b]) => a.localeCompare(b));
  const classAverage =
    summary.results.length > 0 ? summary.results.reduce((sum, r) => sum + Number(r.percentage), 0) / summary.results.length : null;

  return (
    <div className="space-y-4">
      {distributionEntries.length > 0 && (
        <FadeIn className="grid gap-4 md:grid-cols-3">
          <Card className="min-w-0 md:col-span-2">
            <CardHeader>
              <CardTitle>Grade distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Students per grade"
                items={distributionEntries.map(([grade, count]) => ({
                  label: grade,
                  value: count,
                  display: `${count} ${count === 1 ? "student" : "students"}`,
                  tone: grade.startsWith("E") ? "destructive" : "default",
                }))}
              />
            </CardContent>
          </Card>
          {classAverage !== null && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Class average</CardTitle>
              </CardHeader>
              <CardContent>
                <RadialGauge value={classAverage} label="Average percentage" sublabel={`${summary.results.length} students`} />
              </CardContent>
            </Card>
          )}
        </FadeIn>
      )}

      {summary.results.length === 0 ? (
        <EmptyState title="No results" description="No student results were generated for this exam." />
      ) : (
        <Card>
          <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="hidden sm:table-cell">Admission No.</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden text-right sm:table-cell">%</TableHead>
            <TableHead className="text-right">Grade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.results.map((row) => (
            <TableRow key={row.studentId}>
              <TableCell>
                <Link href={`/${institutionSlug}/exams/${examId}/results/${row.studentId}`} className="font-medium hover:underline">
                  {row.studentName}
                </Link>
                {row.isCorrected && <span className="text-muted-foreground ml-1 text-xs">(corrected)</span>}
              </TableCell>
              <TableCell className="hidden sm:table-cell">{row.admissionNo}</TableCell>
              <TableCell className="text-right">
                {row.total}/{row.maxTotal}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell">{row.percentage}%</TableCell>
              <TableCell className="text-right">
                <Badge variant={row.grade.startsWith("E") ? "destructive" : "secondary"}>{row.grade}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
