import { EmptyState } from "@/components/states";
import { Widget } from "@/components/widgets/widget";
import { earnedMilestones } from "@/modules/practice/milestones";
import type { PracticeAttemptSummary, PracticeProgress } from "@/modules/practice/queries";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

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
            <ul className="divide-y">
              {progress.subjects.map((s) => (
                <li key={s.subjectId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate text-sm">{s.subjectName ?? "Subject"}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-medium text-[var(--chart-1)]">{s.averagePercent}%</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.attempts} {s.attempts === 1 ? "quiz" : "quizzes"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Widget>
          <Widget title="Recent attempts">
            <ul className="divide-y">
              {attempts.slice(0, 10).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{a.unitTitle ?? "Unit"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[dateFmt.format(new Date(a.createdAt)), a.subjectName, a.difficulty].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {a.score}/{a.maxScore}
                  </span>
                </li>
              ))}
            </ul>
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
