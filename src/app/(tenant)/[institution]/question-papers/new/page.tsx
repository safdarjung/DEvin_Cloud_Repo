import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { listLabelledTeachableSections } from "@/modules/academics/assignments.queries";
import { listExams } from "@/modules/exams/queries";
import { listAcademicYears } from "@/modules/finance/queries";
import { listCollectionItems, listCollections, listPairMeta, listTeachingPairs } from "@/modules/question-bank/queries";
import { NewPaperWizard } from "@/modules/question-papers/components/NewPaperWizard";
import { listTemplates } from "@/modules/question-papers/queries";

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
  const [years, sections, exams, templates, meta, collections] = await Promise.all([
    listAcademicYears(ctx),
    listLabelledTeachableSections(ctx),
    listExams(ctx),
    listTemplates(ctx, {}),
    listPairMeta(ctx, pairs),
    listCollections(ctx),
  ]);
  const collectionItems = await Promise.all(collections.map((c) => listCollectionItems(ctx, c.id)));
  const collectionSources = collections.map((c, i) => ({
    id: c.id,
    name: c.name,
    questions: collectionItems[i].flatMap((it) => (it.question ? [{ id: it.question.id, gradeId: it.question.gradeId, subjectId: it.question.subjectId, type: it.question.type, marks: it.question.marks }] : [])),
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
        collections={collectionSources}
      />
    </div>
  );
}
