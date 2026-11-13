import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { listCurriculumUnits, listLabelledTeachableSections } from "@/modules/academics/assignments.queries";
import { listTopics } from "@/modules/academics/curriculum.queries";
import { listExams } from "@/modules/exams/queries";
import { listAcademicYears } from "@/modules/finance/queries";
import { listTeachingPairs } from "@/modules/question-bank/queries";
import type { PairMeta } from "@/modules/question-bank/components/question-meta";
import { NewPaperWizard } from "@/modules/question-papers/components/NewPaperWizard";
import { listTemplates } from "@/modules/question-papers/queries";
import { textbooksForGrade } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "New question paper" };

export default async function NewQuestionPaperPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  const pairs = await listTeachingPairs(ctx);
  if (pairs.length === 0) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="New question paper" />
        <EmptyState title="No classes to set a paper for" description="Papers are set for the grades and subjects you teach. Ask the school to assign you a class." />
      </div>
    );
  }
  const [years, sections, exams, templates, unitLists, topicLists, bookLists] = await Promise.all([
    listAcademicYears(ctx),
    listLabelledTeachableSections(ctx),
    listExams(ctx),
    listTemplates(ctx, {}),
    Promise.all(pairs.map((p) => listCurriculumUnits(ctx, { gradeId: p.gradeId, subjectId: p.subjectId }))),
    Promise.all(pairs.map((p) => listTopics(ctx, { gradeId: p.gradeId, subjectId: p.subjectId }))),
    Promise.all(pairs.map((p) => textbooksForGrade(ctx, p.gradeId))),
  ]);
  const meta: PairMeta[] = pairs.map((p, i) => ({
    ...p,
    units: unitLists[i].map((u) => ({ id: u.id, title: u.title })),
    topics: topicLists[i].map((t) => ({ id: t.id, unitId: t.curriculumUnitId, parentId: t.parentId, title: t.title })),
    books: (bookLists[i][p.subjectId] ?? []).map((b) => ({ id: b.id, title: b.title })),
  }));

  return (
    <div className="max-w-3xl">
      <PageHeader title="New question paper" description="Set the paper up in four steps, then edit it like a document." />
      <NewPaperWizard
        institutionSlug={slug}
        pairs={meta}
        years={years}
        sections={sections}
        exams={exams.map((e) => ({ id: e.id, name: e.name }))}
        templates={templates}
      />
    </div>
  );
}
