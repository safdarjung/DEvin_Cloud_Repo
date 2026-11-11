import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { BarList } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { SubjectCurriculum } from "@/modules/academics/components/SubjectCurriculum";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { getStudentProfile } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Subjects" };

export default async function PortalSubjectsPage({
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
  requirePermission(ctx, "student.read");
  requirePermission(ctx, "academics.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/subjects`, allParams);
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
        <FadeIn key={selection.studentId} className="space-y-4">
          {subjects.some((sub) => sub.units.length > 0) && (
            <Widget title="Syllabus coverage" description="Share of each subject's units the class has covered so far.">
              <BarList
                ariaLabel="Units covered by subject"
                max={100}
                format="percent"
                items={subjects
                  .filter((sub) => sub.units.length > 0)
                  .map((sub) => {
                    const covered = sub.units.filter((u) => u.coveredOn).length;
                    return {
                      label: sub.name,
                      value: Math.round((covered / sub.units.length) * 100),
                      display: `${covered} of ${sub.units.length}`,
                    };
                  })}
              />
            </Widget>
          )}
          <SubjectCurriculum subjects={subjects} />
        </FadeIn>
      ) : (
        <EmptyState title="Not enrolled in a class section" description="Ask the school office to enrol you for this year." />
      )}
    </>
  );
}
