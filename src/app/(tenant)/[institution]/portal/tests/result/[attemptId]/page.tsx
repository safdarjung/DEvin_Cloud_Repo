import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { fmtNum } from "@/modules/online-tests/components/test-ui";
import { testResult, type TestResultItem } from "@/modules/online-tests/queries";

export const metadata: Metadata = { title: "Test result" };

const show = (v: unknown): string => (v === null || v === undefined ? "No answer" : Array.isArray(v) ? v.join("; ") : String(v));

function ItemCard({ it, n, answersShown }: { it: TestResultItem; n: number; answersShown: boolean }) {
  return (
    <li className="space-y-1 rounded-lg border bg-card p-3 text-sm" data-testid="result-item">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap"><span className="font-medium">Q{n}.</span> {it.body}</p>
        <Badge variant={it.correct === true ? "success" : it.correct === false ? "destructive" : "secondary"}>
          {it.awarded === null ? "Awaiting marks" : `${fmtNum(it.awarded)} / ${fmtNum(it.marks)}`}
        </Badge>
      </div>
      <p><span className="text-muted-foreground">Your answer:</span> {show(it.answer)}</p>
      {answersShown && it.correctAnswer !== null && it.correctAnswer !== undefined && <p><span className="text-muted-foreground">Correct answer:</span> {show(it.correctAnswer)}</p>}
      {answersShown && it.explanation && <p className="text-muted-foreground">{it.explanation}</p>}
      {it.feedback && <p><span className="text-muted-foreground">Teacher feedback:</span> {it.feedback}</p>}
    </li>
  );
}

export default async function ResultPage({ params }: { params: Promise<{ institution: string; attemptId: string }> }) {
  const { institution: slug, attemptId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.result.read");
  if (!uuid.safeParse(attemptId).success) notFound();
  const back = { href: `/${slug}/portal/tests`, label: "My tests" };

  let result;
  try {
    result = await testResult(ctx, attemptId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    if (e instanceof AppError && e.code === "invalid_state") {
      return (
        <div className="max-w-2xl">
          <PageHeader title="Test submitted" back={back} crumb="Result" />
          <p className="rounded-lg border bg-card p-4 text-sm" data-testid="result-pending">{e.message.includes("in progress") ? e.message : "Your answers are in. Your result will appear here when your teacher releases it."}</p>
          <Link href={back.href} className={`${buttonVariants({ variant: "outline" })} mt-4`}>Back to my tests</Link>
        </div>
      );
    }
    throw e;
  }
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={result.title} crumb="Result" back={back} />
      <div className="rounded-lg border bg-card p-4" data-testid="result-score">
        <p className="text-2xl font-semibold tabular-nums">{result.totalScore === null ? "Marking in progress" : `${fmtNum(result.totalScore)} / ${fmtNum(result.totalMarks)}`}</p>
        {result.totalScore === null && result.objectiveScore !== null && <p className="text-sm text-muted-foreground">Objective part so far: {fmtNum(result.objectiveScore)}. Written answers are still being marked.</p>}
        {result.totalScore !== null && <p className="text-sm text-muted-foreground">Objective {fmtNum(result.objectiveScore)} · Written {fmtNum(result.subjectiveScore)}</p>}
      </div>
      {result.items.length === 0 ? <p className="text-sm text-muted-foreground">Question-by-question marks are not shown for this test.</p> : (
        <ul className="space-y-2">{result.items.map((it, n) => <ItemCard key={it.key} it={it} n={n + 1} answersShown={result.answersShown} />)}</ul>
      )}
    </div>
  );
}
