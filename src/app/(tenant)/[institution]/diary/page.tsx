import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { listLabelledTeachableSections, listSectionSubjects } from "@/modules/academics/assignments.queries";
import { DiaryView } from "@/modules/diary/components/DiaryView";
import { diaryForSection } from "@/modules/diary/queries";
import { aiTaskOn } from "@/modules/ai/task-route";

const TZ = "Asia/Kolkata";

export default async function DiaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { institution: slug } = await params;
  const { section } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "diary");
  requirePermission(ctx, "diary.write");

  const sections = await listLabelledTeachableSections(ctx);
  const active = sections.find((s) => s.id === section) ?? sections[0];

  if (!active) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="Class diary" />
        <EmptyState title="No sections assigned to you" description="Ask the school office to assign you a section and subject." />
      </div>
    );
  }

  const [subjects, entries] = await Promise.all([listSectionSubjects(ctx, active.id), diaryForSection(ctx, active.id)]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  return (
    <div className="max-w-5xl">
      <PageHeader title="Class diary" description={`Homework and notes for ${active.label}`} />
      <SectionSwitcher basePath={`/${slug}/diary`} sections={sections} activeId={active.id} />
      <DiaryView
        institutionSlug={slug}
        classSectionId={active.id}
        sectionLabel={active.label}
        today={today}
        subjects={subjects}
        entries={entries}
        canTranslate={aiTaskOn(ctx, "translate")}
      />
    </div>
  );
}
