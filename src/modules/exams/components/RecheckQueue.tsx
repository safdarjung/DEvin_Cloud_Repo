// T-020 — `/exams/rechecks` queue list (06 §W8). Pure presentational
// server component; `listRecheckQueue` (RLS + exam.recheck.review on the
// page) is the only gate on what reaches it.
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { BarList } from "@/components/widgets/viz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize } from "@/lib/format";
import { recheckStatusVariant } from "@/modules/exams/status";
import type { RecheckQueueRow } from "@/modules/exams/queries";

interface RecheckQueueProps {
  institutionSlug: string;
  rows: RecheckQueueRow[];
}

export function RecheckQueue({ institutionSlug, rows }: RecheckQueueProps) {
  if (rows.length === 0) {
    return <EmptyState title="No recheck requests" description="Requests from guardians and students appear here." />;
  }

  const statusCounts = new Map<string, number>();
  for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

  return (
    <FadeIn className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>Requests by status</CardTitle>
      </CardHeader>
      <CardContent>
        <BarList
          ariaLabel="Recheck requests by status"
          items={[...statusCounts].map(([status, count]) => ({
            label: humanize(status),
            value: count,
            tone: status === "submitted" || status === "under_review" ? "warning" : "default",
          }))}
        />
      </CardContent>
    </Card>
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
                  <Badge variant={recheckStatusVariant(row.status)}>{humanize(row.status)}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{new Date(row.requestedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    </FadeIn>
  );
}
