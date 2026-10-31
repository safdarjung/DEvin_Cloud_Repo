import { notFound } from "next/navigation";
import { LimitedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { AssignmentForm } from "@/modules/academics/components/AssignmentForm";
import { QuizContentView } from "@/modules/academics/components/QuizContentView";
import { getAssignment } from "@/modules/academics/assignments.queries";

// Same mapping as AssignmentList's (client file, so not importable from this server page).
function assignmentStatusVariant(status: string) {
  return status === "published" ? "success" : status === "draft" ? "warning" : "outline";
}

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Submissions</CardTitle>
          <LimitedBadge />
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Planned (F-ACA-06) — out of scope for this packet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
