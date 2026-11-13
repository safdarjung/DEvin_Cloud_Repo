import type { Metadata } from "next";
import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { fmtDateTime, fmtNum, inWindow } from "@/modules/online-tests/components/test-ui";
import { releasedResultsForStudent } from "@/modules/online-tests/portal-queries";
import { myTests, type MyTest } from "@/modules/online-tests/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Tests" };

function Row({ t, base, now }: { t: MyTest; base: string; now: number }) {
  const open = inWindow(t, now);
  const canStart = open && (t.openAttemptId !== null || t.attemptsUsed < t.maxAttempts);
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="my-test">
      <div className="min-w-0">
        <p className="truncate font-medium">{t.title}{t.practice && <Badge variant="info" className="ml-2">Practice</Badge>}</p>
        <p className="text-xs text-muted-foreground">{fmtDateTime(t.opensAt)} to {fmtDateTime(t.closesAt)} · {t.durationMinutes} min · attempts {t.attemptsUsed}/{t.maxAttempts}</p>
      </div>
      <div className="flex gap-2">
        {canStart && <Button asChild><Link href={`${base}/${t.testId}`}>{t.openAttemptId ? "Resume" : "Open"}</Link></Button>}
        {t.lastAttemptId && t.lastStatus !== "in_progress" && (
          <Button asChild variant="outline"><Link href={`${base}/result/${t.lastAttemptId}`}>{t.resultsReleased ? "See result" : "Submitted"}</Link></Button>
        )}
      </div>
    </li>
  );
}

export default async function PortalTestsPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ student?: string }> }) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  const role = ctx.membership.role as "guardian" | "student";
  const base = `/${slug}/portal/tests`;
  const selection = await resolvePortalSelection(ctx, allParams.student, base, allParams);
  const nav = <PortalNav institutionSlug={slug} role={role} selection={selection} activeHref="" canStudy={hasPermission(ctx, "ai.study")} />;

  if (role === "guardian") {
    requirePermission(ctx, "exam.result.read");
    const results = await releasedResultsForStudent(ctx, selection.studentId);
    return (
      <>
        {nav}
        {results.length === 0 ? (
          <EmptyState title="No test results yet" description="Online test results appear here once the school releases them." />
        ) : (
          <FadeIn key={selection.studentId} className="space-y-2">
            <ul className="space-y-2">
              {results.map((r) => (
                <li key={r.attemptId} className="flex items-center justify-between rounded-lg border bg-card p-3" data-testid="child-test-result">
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.totalScore === null ? "Marking in progress" : `${fmtNum(r.totalScore)} / ${fmtNum(r.totalMarks)}`}</p>
                  </div>
                  <Button asChild variant="outline"><Link href={`${base}/result/${r.attemptId}?student=${selection.studentId}`}>Details</Link></Button>
                </li>
              ))}
            </ul>
          </FadeIn>
        )}
      </>
    );
  }

  requirePermission(ctx, "online_test.take");
  const tests = await myTests(ctx);
  const now = Date.now();
  const isDone = (t: MyTest) => t.status === "closed" || t.status === "evaluating" || t.status === "published" || Date.parse(t.closesAt) <= now || (t.lastStatus !== null && t.lastStatus !== "in_progress" && t.attemptsUsed >= t.maxAttempts);
  const open = tests.filter((t) => !isDone(t) && inWindow(t, now));
  const upcoming = tests.filter((t) => !isDone(t) && !inWindow(t, now) && t.status === "scheduled");
  const done = tests.filter(isDone);
  const section = (title: string, list: MyTest[], empty: string) => (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {list.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="space-y-2">{list.map((t) => <Row key={t.testId} t={t} base={base} now={now} />)}</ul>}
    </section>
  );
  return (
    <>
      {nav}
      {tests.length === 0 ? <EmptyState title="No tests yet" description="Online tests set for your class appear here." /> : (
        <FadeIn>
          {section("Open now", open, "Nothing is open right now.")}
          {section("Upcoming", upcoming, "No tests scheduled.")}
          {section("Done", done, "Nothing finished yet.")}
        </FadeIn>
      )}
    </>
  );
}
