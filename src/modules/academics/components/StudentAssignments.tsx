import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import type { AssignmentSummary } from "@/modules/academics/assignments.queries";
import { FadeIn } from "@/components/motion";

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = { published: "success", draft: "warning", closed: "outline" };
const STATUS_LABEL: Record<string, string> = { published: "Published", draft: "Draft", closed: "Closed" };

const SUBMISSION_LABEL = { not_submitted: "Not submitted", submitted: "Submitted", graded: "Graded" } as const;

interface StudentAssignmentsProps {
  institutionSlug: string;
  assignments: AssignmentSummary[];
  /** Student portal only: link each row to the portal detail/submit page and show submission state. */
  portal?: { studentId: string; states: Record<string, { state: keyof typeof SUBMISSION_LABEL; score: number | null; maxScore: number | null }> };
}

/**
 * Published assignments for a guardian's child or a student's own section
 * (acceptance criterion 1/3). Exported for the guardian/student portal
 * (T-034) as well as this module's own /assignments page.
 */
export function StudentAssignments({ institutionSlug, assignments, portal }: StudentAssignmentsProps) {
  if (assignments.length === 0) {
    return <EmptyState title="No published assignments yet" description="New assignments will show up here." />;
  }

  return (
    <ul className="space-y-2">
      {assignments.map((assignment, i) => (
        <FadeIn as="li" delay={Math.min(i, 8) * 0.04} key={assignment.id} className="motion-safe:fill-mode-backwards rounded-md border border-border bg-card p-4">
          <Link
            href={portal ? `/${institutionSlug}/portal/assignments/${assignment.id}?student=${portal.studentId}` : `/${institutionSlug}/assignments/${assignment.id}`} 
            className="inline-flex min-h-10 items-center font-medium hover:underline sm:min-h-0"
          >
            {assignment.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {portal?.states[assignment.id] && (
              <Badge variant={portal.states[assignment.id].state === "graded" ? "success" : portal.states[assignment.id].state === "submitted" ? "info" : "warning"}>
                {SUBMISSION_LABEL[portal.states[assignment.id].state]}
                {portal.states[assignment.id].state === "graded" && portal.states[assignment.id].score !== null
                  ? ` ${portal.states[assignment.id].score}/${portal.states[assignment.id].maxScore}`
                  : ""}
              </Badge>
            )}
            <Badge variant={STATUS_VARIANT[assignment.status] ?? "outline"}>{STATUS_LABEL[assignment.status] ?? assignment.status}</Badge>
            {assignment.dueAt ? <span>Due {new Date(assignment.dueAt).toLocaleDateString()}</span> : null}
          </div>
        </FadeIn>
      ))}
    </ul>
  );
}
