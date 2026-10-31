import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import type { AssignmentSummary } from "@/modules/academics/assignments.queries";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = { published: "success", draft: "warning", closed: "outline" };
const STATUS_LABEL: Record<string, string> = { published: "Published", draft: "Draft", closed: "Closed" };

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
    return <EmptyState title="No published assignments yet" description="New assignments will show up here." />;
  }

  return (
    <ul className="space-y-2">
      {assignments.map((assignment) => (
        <li key={assignment.id} className="rounded-xl border border-border bg-card p-4">
          <Link href={`/${institutionSlug}/assignments/${assignment.id}`} className="inline-flex min-h-10 items-center font-medium hover:underline sm:min-h-0">
            {assignment.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={STATUS_VARIANT[assignment.status] ?? "outline"}>{STATUS_LABEL[assignment.status] ?? assignment.status}</Badge>
            {assignment.dueAt ? <span>Due {new Date(assignment.dueAt).toLocaleDateString()}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
