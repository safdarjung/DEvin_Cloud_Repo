import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule, hasPermission } from "@/lib/auth/require";
import { mySubmissions } from "@/modules/academics/submissions.queries";
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
  requireModule(ctx, "assignments");
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/assignments`);
  const assignments = await listStudentAssignments(ctx, selection.studentId);
  // Student branch only: guardians keep the plain list linking to the staff page.
  const isStudent = ctx.membership.role === "student";
  const subs = isStudent ? await mySubmissions(ctx, selection.studentId) : [];
  const portal = isStudent
    ? {
        studentId: selection.studentId,
        states: Object.fromEntries(subs.map((s) => [s.assignmentId, { state: s.state, score: s.score, maxScore: s.maxScore }])),
      }
    : undefined;

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/assignments"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <StudentAssignments institutionSlug={institutionSlug} assignments={assignments} portal={portal} />
    </>
  );
}
