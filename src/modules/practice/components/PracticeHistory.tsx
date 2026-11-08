import { EmptyState } from "@/components/states";
import { AnimatedList, BarList, Sparkline } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { earnedMilestones } from "@/modules/practice/milestones";
import type { PracticeAttemptSummary, PracticeProgress } from "@/modules/practice/queries";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

const pctOf = (a: PracticeAttemptSummary): number => (a.maxScore > 0 ? Math.round((a.score / a.maxScore) * 100) : 0);

export function streakText(streak: number): string {
  return streak > 0 ? `${streak}-day practice streak` : "No practice streak yet";
}

/** Past attempts, per-subject averages, streak and earned milestones. Server component; no ranking. */
export function PracticeHistory({
  attempts,
  progress,
  windowDays,
}: {
  attempts: PracticeAttemptSummary[];
  progress: PracticeProgress;
  windowDays: number;
}) {
  const milestones = earnedMilestones({
    totalAttempts: progress.totalAttempts,
    streak: progress.streak,
    hasFullMarks: attempts.some((a) => a.maxScore > 0 && a.score === a.maxScore),
  });
  const recent = attempts.slice(0, 10);
  return (
    <section aria-labelledby="practice-progress" className="mt-8 space-y-4">
      <div>
        <h3 id="practice-progress" className="text-base font-semibold tracking-tight">
          Your progress
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
          {streakText(progress.streak)}. Counts days with a practice quiz or saved study item, last {windowDays} days.
        </p>
      </div>

      {attempts.length === 0 ? (
        <EmptyState title="No practice quizzes yet" description="Pick a unit above and generate your first quiz." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Widget title="Average by subject">
            <BarList
              ariaLabel="Average practice score by subject"
              max={100}
              format="percent"
              items={progress.subjects.map((s) => ({
                label: s.subjectName ?? "Subject",
                value: s.averagePercent,
                display: `${s.averagePercent}% · ${s.attempts} ${s.attempts === 1 ? "quiz" : "quizzes"}`,
              }))}
            />
          </Widget>
          <Widget title="Recent attempts">
            {recent.length > 1 && (
              <Sparkline
                data={[...recent].reverse().map(pctOf)}
                summary={`Score on your last ${recent.length} quizzes, oldest to newest: ${[...recent].reverse().map((a) => `${pctOf(a)}%`).join(", ")}.`}
                className="mb-3"
              />
            )}
            <AnimatedList ariaLabel="Recent attempts" className="space-y-0 divide-y">
              {recent.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{a.unitTitle ?? "Unit"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[dateFmt.format(new Date(a.createdAt)), a.subjectName, a.difficulty].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {a.score}/{a.maxScore}
                  </span>
                </div>
              ))}
            </AnimatedList>
          </Widget>
        </div>
      )}

      {milestones.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">Milestones</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {milestones.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
