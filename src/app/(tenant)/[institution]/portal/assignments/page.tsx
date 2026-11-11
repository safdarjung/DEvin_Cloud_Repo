import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { ProgressBar } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule, hasPermission } from "@/lib/auth/require";
import { mySubmissions } from "@/modules/academics/submissions.queries";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { StudentAssignments } from "@/modules/academics/components/StudentAssignments";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Assignments" };

export default async function PortalAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "assignments");
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/assignments`, allParams);
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
  const handedIn = subs.filter((s) => s.state !== "not_submitted").length;
  const graded = subs.filter((s) => s.state === "graded").length;

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/assignments"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn key={selection.studentId} className="space-y-4">
        {isStudent && subs.length > 0 && (
          <Widget title="Your progress">
            <div className="grid gap-4 sm:grid-cols-2">
              <ProgressBar label="Handed in" value={handedIn} max={subs.length} valueLabel={`${handedIn} of ${subs.length}`} />
              <ProgressBar label="Graded" value={graded} max={subs.length} valueLabel={`${graded} of ${subs.length}`} tone="success" />
            </div>
          </Widget>
        )}
        <StudentAssignments institutionSlug={institutionSlug} assignments={assignments} portal={portal} />
      </FadeIn>
    </>
  );
}
