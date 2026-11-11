import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { QuestionBankView } from "@/modules/question-bank/components/QuestionBankView";
import { listQuestions, listTeachingPairs } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";
import { listCurriculumUnits } from "@/modules/academics/assignments.queries";
import { aiTaskOn } from "@/modules/ai/task-route";
import { QuestionPaperBuilder } from "@/modules/ai/components/QuestionPaperBuilder";

export default async function QuestionBankPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  // RLS scopes a teacher to their taught (grade, subject) pairs.
  const [{ items, total }, pairs] = await Promise.all([listQuestions(ctx, QuestionListSchema.parse({ includeArchived: true })), listTeachingPairs(ctx)]);
  const canBuildPaper = pairs.length > 0 && aiTaskOn(ctx, "question_paper_builder");
  const unitLists = canBuildPaper ? await Promise.all(pairs.map((p) => listCurriculumUnits(ctx, { gradeId: p.gradeId, subjectId: p.subjectId }))) : [];

  return (
    <div className="max-w-5xl">
      <PageHeader title="Question bank" description="Reusable questions for your subjects." />
      {canBuildPaper && (
        <div className="mb-4">
          <QuestionPaperBuilder
            institutionSlug={slug}
            pairs={pairs.map((p, i) => ({ ...p, units: unitLists[i].map((u) => ({ id: u.id, title: u.title })) }))}
          />
        </div>
      )}
      <QuestionBankView institutionSlug={slug} items={items} total={total} pairs={pairs} canManage={hasPermission(ctx, "question.manage")} />
    </div>
  );
}
