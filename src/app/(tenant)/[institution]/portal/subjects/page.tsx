import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { SubjectCurriculum } from "@/modules/academics/components/SubjectCurriculum";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { getStudentProfile } from "@/modules/people/queries";

export default async function PortalSubjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  requirePermission(ctx, "academics.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/subjects`);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const sectionId = profile?.enrolment?.classSectionId;
  const subjects = sectionId ? await listPortalSubjects(ctx, sectionId) : null;

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/subjects"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {subjects ? (
        <SubjectCurriculum subjects={subjects} />
      ) : (
        <EmptyState title="Not enrolled in a class section" description="Ask the school office to enrol you for this year." />
      )}
    </>
  );
}
