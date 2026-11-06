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

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={assignment.title}
        description={assignment.dueAt ? `Due ${new Date(assignment.dueAt).toLocaleDateString()}` : undefined}
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

    </div>
  );
}
