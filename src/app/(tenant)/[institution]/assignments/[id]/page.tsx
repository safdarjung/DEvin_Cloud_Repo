import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { AssignmentForm } from "@/modules/academics/components/AssignmentForm";
import { QuizContentView } from "@/modules/academics/components/QuizContentView";
import { assignmentStatusVariant } from "@/modules/academics/status";
import { getAssignment } from "@/modules/academics/assignments.queries";
import { SubmissionsPanel } from "@/modules/academics/components/SubmissionsPanel";
import { submissionsForAssignment } from "@/modules/academics/submissions.queries";

export const metadata: Metadata = { title: "Assignment" };

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "assignments");
  requirePermission(ctx, "assignment.read");

  const assignment = await getAssignment(ctx, id);
  if (!assignment) notFound();

  const canManage = hasPermission(ctx, "assignment.manage");
  const canEdit = canManage && assignment.status === "draft";
  // RLS narrows the roster to the caller's taught sections; drafts have no submissions.
  const roster = canManage && assignment.status !== "draft" ? await submissionsForAssignment(ctx, id) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={assignment.title}
        description={assignment.dueAt ? `Due ${new Date(assignment.dueAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}` : undefined}
        back={{ href: `/${institutionSlug}/assignments`, label: "Assignments" }}
        actions={
          <Badge variant={assignmentStatusVariant(assignment.status)} className="capitalize">
            {assignment.status}
          </Badge>
        }
      />

      {assignment.instructions && (
        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-line text-sm">{assignment.instructions}</CardContent>
        </Card>
      )}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit draft</CardTitle>
          </CardHeader>
          <CardContent>
            {/* No section/subject picker needed — immutable once created (see
                assignments.schemas.ts UpdateAssignmentSchema). */}
            <AssignmentForm institutionSlug={institutionSlug} sections={[]} assignment={assignment} />
          </CardContent>
        </Card>
      ) : assignment.content ? (
        <Card>
          <CardHeader>
            <CardTitle>Quiz</CardTitle>
          </CardHeader>
          <CardContent>
            <QuizContentView content={assignment.content} showAnswers={canManage} />
          </CardContent>
        </Card>
      ) : null}

      {roster && <SubmissionsPanel institutionSlug={institutionSlug} rows={roster} canGrade />}
    </div>
  );
}
