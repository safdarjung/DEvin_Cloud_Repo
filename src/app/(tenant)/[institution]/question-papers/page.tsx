import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { PAPER_STATUS_LABEL, PAPER_STATUS_VARIANT, fmtMarks } from "@/modules/question-papers/components/paper-ui";
import { listPapers } from "@/modules/question-papers/queries";
import { PaperListSchema, PaperStatusSchema } from "@/modules/question-papers/schemas";

export const metadata: Metadata = { title: "Question papers" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function QuestionPapersPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "question_bank");
  requirePermission(ctx, "question.manage");

  const status = PaperStatusSchema.safeParse(one(sp.status));
  const [{ items }, review] = await Promise.all([
    listPapers(ctx, PaperListSchema.parse({ status: status.success ? status.data : undefined, pageSize: 100 })),
    hasPermission(ctx, "paper.approve") ? listPapers(ctx, PaperListSchema.parse({ status: "in_review", pageSize: 100 })) : Promise.resolve(null),
  ]);

  const base = `/${slug}/question-papers`;
  const row = (p: (typeof items)[number]) => (
    <li key={p.id}>
      <Link href={`${base}/${p.id}`} data-testid="paper-row" className="flex flex-col gap-1 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.title}</p>
          <p className="text-xs text-muted-foreground">
            {p.gradeCode} {p.subjectName} · {fmtMarks(p.totalMarks)} marks · v{p.currentVersion}
            {p.examDate ? ` · ${p.examDate}` : ""}
          </p>
        </div>
        <Badge variant={PAPER_STATUS_VARIANT[p.status]}>{PAPER_STATUS_LABEL[p.status]}</Badge>
      </Link>
    </li>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Question papers"
        description="Build, review and print exam papers from your question bank."
        actions={
          <Button asChild>
            <Link href={`${base}/new`}>
              <Plus className="size-4" aria-hidden /> New paper
            </Link>
          </Button>
        }
      />
      {review && (
        <section className="mb-6" aria-labelledby="review-queue">
          <h2 id="review-queue" className="mb-2 text-sm font-semibold">Review queue ({review.items.length})</h2>
          {review.items.length === 0 ? <p className="text-sm text-muted-foreground">No papers waiting for review.</p> : <ul className="space-y-2" data-testid="review-queue">{review.items.map(row)}</ul>}
        </section>
      )}
      <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
        {[{ v: undefined, l: "All" }, ...PaperStatusSchema.options.map((v) => ({ v, l: PAPER_STATUS_LABEL[v] }))].map(({ v, l }) => (
          <Button key={l} asChild size="sm" variant={(status.success ? status.data : undefined) === v ? "default" : "outline"}>
            <Link href={v ? `${base}?status=${v}` : base}>{l}</Link>
          </Button>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyState
          title="No papers yet"
          description="Start a paper from a blueprint, then fill it from your approved questions."
          action={<Button asChild><Link href={`${base}/new`}>New paper</Link></Button>}
        />
      ) : (
        <ul className="space-y-2">{items.map(row)}</ul>
      )}
    </div>
  );
}
