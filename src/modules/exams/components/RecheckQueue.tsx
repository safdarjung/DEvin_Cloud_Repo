// T-020 — `/exams/rechecks` queue list (06 §W8). Pure presentational
// server component; `listRecheckQueue` (RLS + exam.recheck.review on the
// page) is the only gate on what reaches it.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { isRecheckRequestOpen, type RecheckStatus } from "@/modules/exams/recheck-state";
import type { RecheckQueueRow } from "@/modules/exams/queries";

interface RecheckQueueProps {
  institutionSlug: string;
  rows: RecheckQueueRow[];
}

export function RecheckQueue({ institutionSlug, rows }: RecheckQueueProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No recheck requests.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-1 font-medium">Student</th>
          <th className="py-1 font-medium">Exam</th>
          <th className="py-1 font-medium">Subject</th>
          <th className="py-1 font-medium">Status</th>
          <th className="py-1 font-medium">Requested</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-border/50">
            <td className="py-1">
              <Link className="underline" href={`/${institutionSlug}/exams/rechecks/${row.id}`}>
                {row.studentName}
              </Link>
            </td>
            <td className="py-1">{row.examName}</td>
            <td className="py-1">{row.subjectName}</td>
            <td className="py-1">
              <Badge variant={isRecheckRequestOpen(row.status as RecheckStatus) ? "default" : "secondary"}>{row.status}</Badge>
            </td>
            <td className="py-1">{new Date(row.requestedAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
