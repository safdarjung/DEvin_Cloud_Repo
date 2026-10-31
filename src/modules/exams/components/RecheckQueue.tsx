// T-020 — `/exams/rechecks` queue list (06 §W8). Pure presentational
// server component; `listRecheckQueue` (RLS + exam.recheck.review on the
// page) is the only gate on what reaches it.
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { examStatusLabel, recheckStatusVariant } from "@/modules/exams/components/ResultsTable";
import type { RecheckQueueRow } from "@/modules/exams/queries";

interface RecheckQueueProps {
  institutionSlug: string;
  rows: RecheckQueueRow[];
}

export function RecheckQueue({ institutionSlug, rows }: RecheckQueueProps) {
  if (rows.length === 0) {
    return <EmptyState title="No recheck requests" description="Requests from guardians and students appear here." />;
  }

  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="hidden sm:table-cell">Exam</TableHead>
              <TableHead className="hidden sm:table-cell">Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link className="font-medium underline" href={`/${institutionSlug}/exams/rechecks/${row.id}`}>
                    {row.studentName}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{row.examName}</TableCell>
                <TableCell className="hidden sm:table-cell">{row.subjectName}</TableCell>
                <TableCell>
                  <Badge variant={recheckStatusVariant(row.status)}>{examStatusLabel(row.status)}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{new Date(row.requestedAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
