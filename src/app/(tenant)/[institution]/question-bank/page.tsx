import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { listCurriculumUnits } from "@/modules/academics/assignments.queries";
import { listTopics } from "@/modules/academics/curriculum.queries";
import { QuestionPaperBuilder } from "@/modules/ai/components/QuestionPaperBuilder";
import { aiTaskOn } from "@/modules/ai/task-route";
import { QuestionBankView } from "@/modules/question-bank/components/QuestionBankView";
import type { PairMeta } from "@/modules/question-bank/components/question-meta";
import { listCollectionItems, listCollections, listQuestions, listTeachingPairs } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";
import { textbooksForGrade } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Question bank" };

export default async function QuestionBankPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  // RLS scopes a teacher to their taught (grade, subject) pairs.
  const [{ items, total }, pairs, collections] = await Promise.all([
    listQuestions(ctx, QuestionListSchema.parse({ includeArchived: true, pageSize: 100 })),
    listTeachingPairs(ctx),
    listCollections(ctx),
  ]);

  const [unitLists, topicLists, bookLists, collectionLists] = await Promise.all([
    Promise.all(pairs.map((p) => listCurriculumUnits(ctx, { gradeId: p.gradeId, subjectId: p.subjectId }))),
    Promise.all(pairs.map((p) => listTopics(ctx, { gradeId: p.gradeId, subjectId: p.subjectId }))),
    Promise.all(pairs.map((p) => textbooksForGrade(ctx, p.gradeId))),
    Promise.all(collections.map((c) => listCollectionItems(ctx, c.id))),
  ]);
  const meta: PairMeta[] = pairs.map((p, i) => ({
    ...p,
    units: unitLists[i].map((u) => ({ id: u.id, title: u.title })),
    topics: topicLists[i].map((t) => ({ id: t.id, unitId: t.curriculumUnitId, parentId: t.parentId, title: t.title })),
    books: (bookLists[i][p.subjectId] ?? []).map((b) => ({ id: b.id, title: b.title })),
  }));

  // Topic filter covers every subject shown, including ones a reviewer does not teach.
  const shownPairs = [...new Map(items.map((q) => [`${q.gradeId}:${q.subjectId}`, q])).values()];
  const filterLists = await Promise.all(shownPairs.map((q) => listTopics(ctx, { gradeId: q.gradeId, subjectId: q.subjectId })));
  const filterTopics = shownPairs.flatMap((q, i) => filterLists[i].map((t) => ({ value: t.id, label: `${q.gradeCode} ${q.subjectName}: ${t.title}` })));

  const canBuildPaper = pairs.length > 0 && aiTaskOn(ctx, "question_paper_builder");
  return (
    <div className="max-w-5xl">
      <PageHeader title="Question bank" description="Reusable questions for your subjects." />
      {canBuildPaper && (
        <div className="mb-4">
          <QuestionPaperBuilder institutionSlug={slug} pairs={meta.map((p) => ({ gradeId: p.gradeId, gradeCode: p.gradeCode, subjectId: p.subjectId, subjectName: p.subjectName, units: p.units }))} />
        </div>
      )}
      <QuestionBankView
        institutionSlug={slug}
        items={items}
        total={total}
        pairs={meta}
        filterTopics={filterTopics}
        canManage={hasPermission(ctx, "question.manage")}
        canApprove={hasPermission(ctx, "question.approve")}
        collections={collections}
        collectionItems={Object.fromEntries(collections.map((c, i) => [c.id, collectionLists[i]]))}
      />
    </div>
  );
}
