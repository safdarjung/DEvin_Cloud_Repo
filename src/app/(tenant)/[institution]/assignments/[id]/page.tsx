import { notFound } from "next/navigation";
import { LimitedBadge } from "@/components/honesty";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { AssignmentForm } from "@/modules/academics/components/AssignmentForm";
import { QuizContentView } from "@/modules/academics/components/QuizContentView";
import { getAssignment } from "@/modules/academics/assignments.queries";

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
      <div>
        <h1 className="text-xl font-semibold">{assignment.title}</h1>
        <p className="text-muted-foreground text-sm">Status: {assignment.status}</p>
        {assignment.dueAt && (
          <p className="text-muted-foreground text-sm">Due {new Date(assignment.dueAt).toLocaleDateString()}</p>
        )}
      </div>

      {assignment.instructions && <p>{assignment.instructions}</p>}

      {canEdit ? (
        // No section/subject picker needed — immutable once created (see
        // assignments.schemas.ts UpdateAssignmentSchema).
        <AssignmentForm institutionSlug={institutionSlug} sections={[]} assignment={assignment} />
      ) : assignment.content ? (
        <QuizContentView content={assignment.content} showAnswers={canManage} />
      ) : null}

      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          Submissions <LimitedBadge />
        </h2>
        <p className="text-muted-foreground text-sm">Planned (F-ACA-06) — out of scope for this packet.</p>
      </div>
    </div>
  );
}
