import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { AssignmentList } from "@/modules/academics/components/AssignmentList";
import { StudentAssignments } from "@/modules/academics/components/StudentAssignments";
import {
  listGuardianChildren,
  listStudentAssignments,
  listTeacherAssignments,
} from "@/modules/academics/assignments.queries";

export default async function AssignmentsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "assignment.read");

  // Guardian/student: published assignments for their own child/section
  // (06 §W6, acceptance criterion 1/3) — the full portal UX is T-034's.
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") {
    const studentIds =
      ctx.membership.role === "student" && ctx.membership.studentId
        ? [ctx.membership.studentId]
        : await listGuardianChildren(ctx);
    const perChild = await Promise.all(studentIds.map((id) => listStudentAssignments(ctx, id)));

    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Assignments</h1>
        <StudentAssignments institutionSlug={institutionSlug} assignments={perChild.flat()} />
      </div>
    );
  }

  const canManage = hasPermission(ctx, "assignment.manage");
  const assignments = await listTeacherAssignments(ctx);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Assignments</h1>
          <p className="text-muted-foreground text-sm">
            {canManage ? "Assignments you created." : "Assignments across the institution."}
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href={`/${institutionSlug}/assignments/new`}>New assignment</Link>
          </Button>
        )}
      </div>
      <AssignmentList institutionSlug={institutionSlug} assignments={assignments} canManage={canManage} />
    </div>
  );
}
