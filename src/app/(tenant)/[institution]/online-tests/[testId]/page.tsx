import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, PenLine } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { listLabelledTeachableSections } from "@/modules/academics/assignments.queries";
import { AppError } from "@/lib/actions/result";
import { AutoRefresh } from "@/modules/online-tests/components/AutoRefresh";
import { TestControls } from "@/modules/online-tests/components/TestControls";
import { ATTEMPT_LABEL, RELEASE_LABEL, TEST_STATUS_LABEL, TEST_STATUS_VARIANT, effectiveStatus, fmtDateTime, nowMs, fmtNum, inWindow } from "@/modules/online-tests/components/test-ui";
import { getTest, markingQueue } from "@/modules/online-tests/queries";
import type { AttemptStatus } from "@/modules/online-tests/schemas";
import { uuid } from "@/lib/schemas/common";

export const metadata: Metadata = { title: "Online test" };

export default async function OnlineTestPage({ params }: { params: Promise<{ institution: string; testId: string }> }) {
  const { institution: slug, testId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.manage");
  if (!uuid.safeParse(testId).success) notFound();

  const test = await getTest(ctx, testId).catch((e) => { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; });
  const [sections, queue] = await Promise.all([
    listLabelledTeachableSections(ctx).catch(() => []),
    hasPermission(ctx, "online_test.mark") ? markingQueue(ctx, testId).catch(() => null) : Promise.resolve(null),
  ]);
  const sectionLabels = Object.fromEntries(sections.map((s) => [s.id, s.label]));
  const base = `/${slug}/online-tests/${testId}`;
  const submitted = test.attempts.submitted + test.attempts.auto_submitted + test.attempts.evaluated;

  return (
    <div className="max-w-5xl space-y-6">
      {inWindow(test, nowMs()) && <AutoRefresh />}
      <PageHeader
        title={test.title}
        crumb={test.title}
        description={`${test.gradeCode} ${test.subjectName} · paper v${test.paperVersionNo} · ${test.durationMinutes} min · ${test.maxAttempts} attempt${test.maxAttempts > 1 ? "s" : ""}${test.practice ? " · Practice" : ""}`}
        actions={
          <>
            <Badge variant={TEST_STATUS_VARIANT[effectiveStatus(test, nowMs())]} data-testid="test-status">{TEST_STATUS_LABEL[effectiveStatus(test, nowMs())]}</Badge>
            {hasPermission(ctx, "online_test.mark") && (
              <>
                <Button asChild variant="outline" size="sm"><Link href={`${base}/marking`}><PenLine className="size-4" aria-hidden /> Marking</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href={`${base}/analytics`}><BarChart3 className="size-4" aria-hidden /> Analytics</Link></Button>
              </>
            )}
          </>
        }
      />

      <TestControls slug={slug} test={test} sectionLabels={sectionLabels} canPublish={hasPermission(ctx, "online_test.publish")} canPush={hasPermission(ctx, "exam.marks.enter")} />

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Schedule and release">
        <dl className="rounded-lg border bg-card p-3 text-sm">
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Opens</dt><dd>{fmtDateTime(test.opensAt)}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Closes</dt><dd>{fmtDateTime(test.closesAt)}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Classes</dt><dd>{test.sectionIds.map((id) => sectionLabels[id] ?? "Class").join(", ")}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Shuffle</dt><dd>{test.shuffle ? "Yes" : "No"}</dd></div>
        </dl>
        <dl className="rounded-lg border bg-card p-3 text-sm">
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Scores shown</dt><dd>{RELEASE_LABEL[test.showResults]}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Answers shown</dt><dd>{RELEASE_LABEL[test.showAnswers]}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Published</dt><dd>{test.publishedAt ? fmtDateTime(test.publishedAt) : "Not yet"}</dd></div>
          <div className="flex justify-between py-0.5"><dt className="text-muted-foreground">Sent to marks entry</dt><dd>{test.marksPushedAt ? fmtDateTime(test.marksPushedAt) : "Not yet"}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="mon-h" data-testid="monitor">
        <h2 id="mon-h" className="mb-2 text-base font-semibold">Attempts</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([["submitted_total", "Submitted", submitted], ...(Object.keys(ATTEMPT_LABEL) as AttemptStatus[]).map((k) => [k, ATTEMPT_LABEL[k], test.attempts[k]] as const)] as const).map(([k, label, n]) => (
            <div key={k} className="rounded-lg border bg-card p-3" data-testid={`count-${k}`}>
              <p className="text-2xl font-semibold tabular-nums">{n}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {queue && queue.attempts.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Student</th><th className="font-medium">Status</th><th className="font-medium">Written to mark</th><th className="text-right font-medium">Score</th></tr></thead>
            <tbody>
              {queue.attempts.map((a) => (
                <tr key={a.attemptId} className="border-b" data-testid="attempt-row">
                  <td className="py-1.5">{a.studentName}</td>
                  <td>{ATTEMPT_LABEL[a.status]}</td>
                  <td>{a.pending}</td>
                  <td className="text-right tabular-nums">{fmtNum(a.totalScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
