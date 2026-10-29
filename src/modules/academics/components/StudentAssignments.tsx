import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { AssignmentSummary } from "@/modules/academics/assignments.queries";

interface StudentAssignmentsProps {
  institutionSlug: string;
  assignments: AssignmentSummary[];
}

/**
 * Published assignments for a guardian's child or a student's own section
 * (acceptance criterion 1/3). Exported for the guardian/student portal
 * (T-034) as well as this module's own /assignments page.
 */
export function StudentAssignments({ institutionSlug, assignments }: StudentAssignmentsProps) {
  if (assignments.length === 0) {
    return <p className="text-muted-foreground text-sm">No published assignments yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {assignments.map((assignment) => (
        <li key={assignment.id} className="rounded-lg border border-border p-3">
          <Link href={`/${institutionSlug}/assignments/${assignment.id}`} className="font-medium hover:underline">
            {assignment.title}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{assignment.status}</Badge>
            {assignment.dueAt ? <span>Due {new Date(assignment.dueAt).toLocaleDateString()}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
