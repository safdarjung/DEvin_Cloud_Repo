// T-019 — controller/teacher results list with a grade distribution
// summary (also used by T-039). Server component: the rows and
// distribution are already computed by listResultsForExam (RLS-scoped);
// this only renders them. Links each row to the per-student report card.
import Link from "next/link";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExamResultsSummary } from "@/modules/exams/queries";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/** Exam status (check constraint in 20261028000009_exams.sql): draft, marks_entry, verification, published. */
export function examStatusVariant(status: string): BadgeVariant {
  if (status === "published") return "success";
  if (status === "verification") return "warning";
  if (status === "marks_entry") return "info";
  return "outline";
}

export function examStatusLabel(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Recheck status (same migration): submitted, under_review, approved, rejected, applied. */
export function recheckStatusVariant(status: string): BadgeVariant {
  if (status === "approved" || status === "applied") return "success";
  if (status === "rejected") return "destructive";
  if (status === "under_review") return "info";
  if (status === "submitted") return "warning";
  return "outline";
}

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
            <Badge key={grade} variant="outline">
              {grade}: {count}
            </Badge>
          ))}
        </div>
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
