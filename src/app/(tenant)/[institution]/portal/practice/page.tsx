import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { getStudentProfile } from "@/modules/people/queries";
import { PracticeHistory } from "@/modules/practice/components/PracticeHistory";
import { PracticeStudio } from "@/modules/practice/components/PracticeStudio";
import { myPracticeAttempts, practiceProgress, STREAK_WINDOW_DAYS } from "@/modules/practice/queries";

export const metadata: Metadata = { title: "Practice" };

// Student-only: practice.attempt + ai.study. Guardians are sent back to the overview.
export default async function PortalPracticePage({
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
  if (!hasPermission(ctx, "practice.attempt") || !hasPermission(ctx, "ai.study")) redirect(`/${institutionSlug}/portal`);
  if (!isModuleEnabled(ctx, "practice")) notFound();

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/practice`, allParams);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const sectionId = profile?.enrolment?.classSectionId;
  const [subjects, attempts, progress] = await Promise.all([
    sectionId ? listPortalSubjects(ctx, sectionId) : Promise.resolve(null),
    myPracticeAttempts(ctx, selection.studentId),
    practiceProgress(ctx, selection.studentId),
  ]);

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role="student" selection={selection} activeHref="/practice" canStudy />
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">Practice</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Quizzes generated from your curriculum units. Questions are AI-made and can contain mistakes.</p>
      </div>
      {subjects ? (
        <PracticeStudio
          institutionSlug={institutionSlug}
          studentId={selection.studentId}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name, units: s.units.map((u) => ({ id: u.id, title: u.title })) }))}
        />
      ) : (
        <EmptyState title="Not enrolled in a class section" description="Ask the school office to enrol you for this year." />
      )}
      <PracticeHistory attempts={attempts} progress={progress} windowDays={STREAK_WINDOW_DAYS} />
    </>
  );
}
