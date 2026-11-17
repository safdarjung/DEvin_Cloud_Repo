import type { Metadata } from "next";
import { defaultDiarySectionId } from "@/modules/diary/queries";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { listLabelledTeachableSections, listSectionSubjects } from "@/modules/academics/assignments.queries";
import { LessonPlansView } from "@/modules/academics/components/LessonPlansView";
import { curriculumLessonPlans, curriculumSectionUnits } from "@/modules/academics/curriculum.queries";
import { aiTaskOn } from "@/modules/ai/task-route";
import { unitChapters } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Lesson plans" };

const TZ = "Asia/Kolkata";

export default async function LessonPlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { institution: slug } = await params;
  const { section } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "lesson_plans");
  requirePermission(ctx, "assignment.read");

  // Teachers get only the sections they teach (listTeachableSections + RLS); never the admin client.
  const sections = await listLabelledTeachableSections(ctx);
  // No ?section=: open the teacher's own class, as the class diary does.
  const fallbackId = section && sections.some((s) => s.id === section) ? undefined : await defaultDiarySectionId(ctx, sections);
  const active = sections.find((s) => s.id === (fallbackId ?? section)) ?? sections[0];

  if (!active) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="Lesson plans" />
        <EmptyState title="No sections assigned to you" description="Ask the school office to assign you a section and subject." />
      </div>
    );
  }

  const subjects = await listSectionSubjects(ctx, active.id, { ownOnly: true });
  const [plans, unitsPerSubject] = await Promise.all([
    curriculumLessonPlans(ctx, { classSectionId: active.id }),
    Promise.all(subjects.map((s) => curriculumSectionUnits(ctx, { classSectionId: active.id, subjectId: s.id }))),
  ]);
  const chapters = await unitChapters(ctx, unitsPerSubject.flat().map((u) => u.id));
  const unitChapterLabels = Object.fromEntries(Object.entries(chapters).map(([id, c]) => [id, `Chapter ${c.chapterNo}${c.chapterTitle ? `: ${c.chapterTitle}` : ""} of ${c.bookTitle}`]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  return (
    <div className="max-w-5xl">
      <PageHeader title="Lesson plans" description={`Plans and syllabus coverage for ${active.label}`} />
      <SectionSwitcher basePath={`/${slug}/lesson-plans`} sections={sections} activeId={active.id} />
      <LessonPlansView
        institutionSlug={slug}
        classSectionId={active.id}
        today={today}
        subjects={subjects.map((s, i) => ({ subjectId: s.id, subjectName: s.name, units: unitsPerSubject[i] }))}
        plans={plans}
        canManage={hasPermission(ctx, "assignment.manage")}
        canDraftWithAi={aiTaskOn(ctx, "lesson_plan_writer")}
        unitChapterLabels={unitChapterLabels}
      />
    </div>
  );
}
