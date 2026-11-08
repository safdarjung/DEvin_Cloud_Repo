import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { AssignmentList } from "@/modules/academics/components/AssignmentList";
import { StudentAssignments } from "@/modules/academics/components/StudentAssignments";
import { FadeIn } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList } from "@/components/widgets/viz";
import { humanize } from "@/lib/format";
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
  requireModule(ctx, "assignments");
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
        <PageHeader title="Assignments" />
        <StudentAssignments institutionSlug={institutionSlug} assignments={perChild.flat()} />
      </div>
    );
  }

  const canManage = hasPermission(ctx, "assignment.manage");
  const assignments = await listTeacherAssignments(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assignments"
        description={canManage ? "Assignments you created." : "Assignments across the institution."}
        actions={
          canManage && (
            <Button asChild>
              <Link href={`/${institutionSlug}/assignments/new`}>New assignment</Link>
            </Button>
          )
        }
      />
      {assignments.length > 0 ? (
        <FadeIn className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <AssignmentList institutionSlug={institutionSlug} assignments={assignments} canManage={canManage} />
          </div>
          <Card className="min-w-0 self-start">
            <CardHeader>
              <CardTitle>By status</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Assignments by status"
                max={assignments.length}
                items={(["draft", "published", "closed"] as const).map((status) => ({
                  label: humanize(status),
                  value: assignments.filter((a) => a.status === status).length,
                  tone: status === "draft" ? "warning" : "default",
                }))}
              />
            </CardContent>
          </Card>
        </FadeIn>
      ) : (
        <AssignmentList institutionSlug={institutionSlug} assignments={assignments} canManage={canManage} />
      )}
    </div>
  );
}
