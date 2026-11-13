import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { QuestionPaperBuilder } from "@/modules/ai/components/QuestionPaperBuilder";
import { aiTaskOn } from "@/modules/ai/task-route";
import { QuestionBankView } from "@/modules/question-bank/components/QuestionBankView";
import { listCollectionItems, listCollections, listPairMeta, listQuestions, listTeachingPairs } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";

export const metadata: Metadata = { title: "Question bank" };

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function QuestionBankPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  // Filters and paging run in SQL (URL params). Bad values fall back to "all" rather than erroring.
  const filter = QuestionListSchema.safeParse({
    includeArchived: true,
    pageSize: PAGE_SIZE,
    page: Number(one(sp.page)) || 1,
    ...Object.fromEntries((["status", "type", "difficulty", "origin"] as const).map((k) => [k, one(sp[k]) || undefined])),
    curriculumTopicId: one(sp.topic) || undefined,
  });
  const active = filter.success ? filter.data : QuestionListSchema.parse({ includeArchived: true, pageSize: PAGE_SIZE });
  const canApprove = hasPermission(ctx, "question.approve");
  const canManage = hasPermission(ctx, "question.manage");

  // RLS scopes a teacher to their taught (grade, subject) pairs.
  const [{ items, total }, pairs, collections, queueLists, stemLists] = await Promise.all([
    listQuestions(ctx, active),
    listTeachingPairs(ctx),
    listCollections(ctx),
    // Review queue and passage stems are not page-bound: they ignore the list filters.
    canApprove ? Promise.all(["draft", "in_review"].map((status) => listQuestions(ctx, QuestionListSchema.parse({ status, pageSize: 100 })))) : Promise.resolve([]),
    canManage ? Promise.all(["passage", "case_based"].map((type) => listQuestions(ctx, QuestionListSchema.parse({ type, pageSize: 100 })))) : Promise.resolve([]),
  ]);
  const queue = queueLists.flatMap((r) => r.items);
  const stems = stemLists.flatMap((r) => r.items);

  const [meta, collectionLists] = await Promise.all([
    listPairMeta(ctx, pairs),
    Promise.all(collections.map((c) => listCollectionItems(ctx, c.id))),
  ]);

  const filterTopics = meta.flatMap((p) => p.topics.map((t) => ({ value: t.id, label: `${p.gradeCode} ${p.subjectName}: ${t.title}` })));

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
        page={active.page}
        pageSize={PAGE_SIZE}
        queue={queue}
        stems={stems}
        filters={{ status: active.status, type: active.type, difficulty: active.difficulty, origin: active.origin, topic: active.curriculumTopicId }}
        pairs={meta}
        filterTopics={filterTopics}
        canManage={canManage}
        canApprove={canApprove}
        collections={collections}
        collectionItems={Object.fromEntries(collections.map((c, i) => [c.id, collectionLists[i]]))}
      />
    </div>
  );
}
