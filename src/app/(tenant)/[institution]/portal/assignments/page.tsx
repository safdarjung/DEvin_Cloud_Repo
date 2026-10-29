import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { StudentAssignments } from "@/modules/academics/components/StudentAssignments";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export default async function PortalAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam);
  const assignments = await listStudentAssignments(ctx, selection.studentId);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/assignments"
      />
      <StudentAssignments institutionSlug={institutionSlug} assignments={assignments} />
    </>
  );
}
