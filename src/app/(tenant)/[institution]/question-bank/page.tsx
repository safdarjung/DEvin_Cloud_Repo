import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { QuestionBankView } from "@/modules/question-bank/components/QuestionBankView";
import { listQuestions, listTeachingPairs } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";

export default async function QuestionBankPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  // RLS scopes a teacher to their taught (grade, subject) pairs.
  const [{ items, total }, pairs] = await Promise.all([listQuestions(ctx, QuestionListSchema.parse({ includeArchived: true })), listTeachingPairs(ctx)]);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Question bank" description="Reusable questions for your subjects." />
      <QuestionBankView institutionSlug={slug} items={items} total={total} pairs={pairs} canManage={hasPermission(ctx, "question.manage")} />
    </div>
  );
}
