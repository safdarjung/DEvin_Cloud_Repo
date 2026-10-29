// T-019 — controller/teacher results list with a grade distribution
// summary (also used by T-039). Server component: the rows and
// distribution are already computed by listResultsForExam (RLS-scoped);
// this only renders them. Links each row to the per-student report card.
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExamResultsSummary } from "@/modules/exams/queries";

interface ResultsTableProps {
  institutionSlug: string;
  examId: string;
  summary: ExamResultsSummary;
}

export function ResultsTable({ institutionSlug, examId, summary }: ResultsTableProps) {
  const distributionEntries = Object.entries(summary.gradeDistribution).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      {distributionEntries.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {distributionEntries.map(([grade, count]) => (
            <span key={grade} className="rounded-md border border-border px-2 py-1">
              {grade}: {count}
            </span>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Admission No.</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Grade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.results.map((row) => (
            <TableRow key={row.studentId}>
              <TableCell>
                <Link href={`/${institutionSlug}/exams/${examId}/results/${row.studentId}`} className="hover:underline">
                  {row.studentName}
                </Link>
                {row.isCorrected && <span className="text-muted-foreground ml-1 text-xs">(corrected)</span>}
              </TableCell>
              <TableCell>{row.admissionNo}</TableCell>
              <TableCell className="text-right">
                {row.total}/{row.maxTotal}
              </TableCell>
              <TableCell className="text-right">{row.percentage}%</TableCell>
              <TableCell className="text-right">{row.grade}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
