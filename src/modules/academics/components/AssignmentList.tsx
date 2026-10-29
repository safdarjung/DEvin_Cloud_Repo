"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/result";
import { publishAssignment } from "@/modules/academics/assignments.actions";
import type { AssignmentSummary } from "@/modules/academics/assignments.queries";

interface AssignmentListProps {
  institutionSlug: string;
  assignments: AssignmentSummary[];
  /** Whether the signed-in member can create/publish (assignment.manage) — read-only roles get no action column. */
  canManage: boolean;
}

function PublishButton({ institutionSlug, assignmentId }: { institutionSlug: string; assignmentId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async () => publishAssignment(institutionSlug, { assignmentId }),
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Publishing…" : "Publish"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}

export function AssignmentList({ institutionSlug, assignments, canManage }: AssignmentListProps) {
  if (assignments.length === 0) {
    return <p className="text-muted-foreground text-sm">No assignments yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Due</TableHead>
          {canManage && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((assignment) => (
          <TableRow key={assignment.id}>
            <TableCell>
              <Link href={`/${institutionSlug}/assignments/${assignment.id}`} className="hover:underline">
                {assignment.title}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={assignment.status === "published" ? "default" : "secondary"}>{assignment.status}</Badge>
            </TableCell>
            <TableCell>{assignment.dueAt ? new Date(assignment.dueAt).toLocaleDateString() : "—"}</TableCell>
            {canManage && (
              <TableCell>
                {assignment.status === "draft" ? (
                  <PublishButton institutionSlug={institutionSlug} assignmentId={assignment.id} />
                ) : null}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
