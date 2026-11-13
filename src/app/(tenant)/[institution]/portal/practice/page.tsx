import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { PracticeHub } from "@/modules/learning/components/PracticeHub";
import { ProgressChart } from "@/modules/learning/components/ProgressChart";
import { WeakAreaList } from "@/modules/learning/components/WeakAreaList";
import { myProgress, myWeakTopics, practiceBankCounts } from "@/modules/learning/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { getStudentProfile } from "@/modules/people/queries";
import { PracticeHistory } from "@/modules/practice/components/PracticeHistory";
import { myPracticeAttempts, practiceProgress, STREAK_WINDOW_DAYS } from "@/modules/practice/queries";
import { unitChapters } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Learning & Practice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);

// Student-only: practice.attempt + ai.study. Guardians are sent back to the overview.
export default async function PortalPracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string; unit?: string; topic?: string; mode?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  if (!hasPermission(ctx, "practice.attempt") || !hasPermission(ctx, "ai.study")) redirect(`/${institutionSlug}/portal`);
  if (!isModuleEnabled(ctx, "practice")) notFound();

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/practice`, allParams);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const sectionId = profile?.enrolment?.classSectionId;
  const canLearn = hasPermission(ctx, "mastery.read") && isModuleEnabled(ctx, "mastery");
  const [subjects, attempts, progress, weak, weeks, counts] = await Promise.all([
    sectionId ? listPortalSubjects(ctx, sectionId) : Promise.resolve(null),
    myPracticeAttempts(ctx, selection.studentId),
    practiceProgress(ctx, selection.studentId),
    canLearn ? myWeakTopics(ctx, { studentId: selection.studentId }) : Promise.resolve({ studentId: selection.studentId, areas: [] }),
    canLearn ? myProgress(ctx, { studentId: selection.studentId }) : Promise.resolve([]),
    canLearn ? practiceBankCounts(ctx, { studentId: selection.studentId }) : Promise.resolve([]),
  ]);
  const chapters = await unitChapters(ctx, weak.areas.map((a) => a.next.summaryUnitId));
  const chapterUrls = Object.fromEntries(Object.entries(chapters).flatMap(([id, c]) => (c.url ? [[id, c.url]] : [])));
  const subjectNames = Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name]));
  const portalBase = `/${institutionSlug}/portal`;

  const perUnit = new Map<string, number>();
  for (const c of counts) perUnit.set(c.unitId, (perUnit.get(c.unitId) ?? 0) + c.available);
  const bankSubjects = (subjects ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    units: s.units.filter((u) => (perUnit.get(u.id) ?? 0) > 0).map((u) => ({ id: u.id, title: u.title, available: perUnit.get(u.id) ?? 0 })),
  }));
  const hasBank = bankSubjects.some((s) => s.units.length > 0);
  const mode = allParams.mode === "ai" || (allParams.mode !== "bank" && !hasBank) ? "ai" : "bank";

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role="student" selection={selection} activeHref="/practice" canStudy />
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">Learning &amp; Practice</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          See what to work on, then practise it. Practice doesn&apos;t affect your marks. AI quizzes can contain mistakes.
        </p>
      </div>

      {canLearn && (
        <section aria-labelledby="lp-weak" className="mb-8 space-y-3">
          <h3 id="lp-weak" className="text-base font-semibold tracking-tight">Where to focus</h3>
          <WeakAreaList areas={weak.areas.slice(0, 6)} subjectNames={subjectNames} portalBase={portalBase} chapterUrls={chapterUrls} />
        </section>
      )}

      <section aria-labelledby="lp-practice" className="space-y-3">
        <h3 id="lp-practice" className="text-base font-semibold tracking-tight">Practise</h3>
        {subjects ? (
          <PracticeHub
            institutionSlug={institutionSlug}
            studentId={selection.studentId}
            bankSubjects={bankSubjects}
            aiSubjects={subjects.map((s) => ({ id: s.id, name: s.name, units: s.units.map((u) => ({ id: u.id, title: u.title })) }))}
            initialMode={mode}
            initialUnitId={uuidOr(allParams.unit)}
            initialTopicId={uuidOr(allParams.topic)}
          />
        ) : (
          <EmptyState title="Not enrolled in a class section" description="Ask the school office to enrol you for this year." />
        )}
      </section>

      {canLearn && (
        <div className="mt-8">
          <ProgressChart weeks={weeks} />
        </div>
      )}
      <PracticeHistory attempts={attempts} progress={progress} windowDays={STREAK_WINDOW_DAYS} />
    </>
  );
}
