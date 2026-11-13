import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { PaperEditor } from "@/modules/question-papers/components/PaperEditor";
import { getPaper, listTemplates, listVersions, validatePaper, type PaperValidation } from "@/modules/question-papers/queries";

export const metadata: Metadata = { title: "Question paper" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function QuestionPaperPage({ params, searchParams }: { params: Promise<{ institution: string; paperId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institution: slug, paperId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(paperId)) notFound();
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  const paper = await getPaper(ctx, paperId);
  if (!paper) notFound();
  const [validation, versions, templates] = await Promise.all([
    validatePaper(ctx, paperId).catch((): PaperValidation | null => null),
    listVersions(ctx, paperId),
    listTemplates(ctx, { gradeId: paper.gradeId, subjectId: paper.subjectId }),
  ]);
  const chapterNos = (one(sp.chapters) ?? "").split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 100);

  return (
    <div className="max-w-4xl">
      <PageHeader title={paper.title} crumb={paper.title} description={`${paper.gradeCode} ${paper.subjectName} · ${paper.totalMarks} marks`} back={{ href: `/${slug}/question-papers`, label: "Question papers" }} />
      <PaperEditor
        institutionSlug={slug}
        paper={paper}
        validation={validation}
        versions={versions}
        templates={templates}
        canApprove={hasPermission(ctx, "paper.approve")}
        canPublish={hasPermission(ctx, "paper.publish")}
        source={{ bookId: one(sp.book), chapterNos: chapterNos.length ? chapterNos.slice(0, 20) : undefined, unitId: one(sp.unit), topicIds: one(sp.topics)?.split(",").filter((t) => UUID_RE.test(t)).slice(0, 20) }}
      />
    </div>
  );
}
