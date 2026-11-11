// Study studio progress: streak, study time, accuracy over time and by
// subject, and weak topics with a next step. Server component; no ranking.
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { BarList, Sparkline } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import type { StudyProgress } from "@/modules/study/queries";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" });
const weekFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StudyProgressView({ progress, dueCards, studioHref }: { progress: StudyProgress; dueCards: number; studioHref: string | null }) {
  const weeks = progress.weekly.filter((w) => w.percent !== null);
  const latest = weeks.at(-1)?.percent ?? null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Study streak" value={`${progress.streak} ${progress.streak === 1 ? "day" : "days"}`} hint="Days with a quiz or study session" />
        <Stat label="Studied this week" value={`${progress.minutesThisWeek} min`} hint="Logged drills and quizzes" />
        <Stat label="Flashcards due" value={String(dueCards)} hint="Due today or earlier" />
        <Stat label="Recent accuracy" value={latest === null ? "—" : `${latest}%`} hint="Practice quizzes, this week" />
      </div>

      {progress.questionsAnswered === 0 ? (
        <EmptyState title="No practice yet" description="Take a quiz from Create or Quizzes and your accuracy shows up here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Widget title="Accuracy by subject" description="All practice and studio quizzes, last 90 days.">
            <BarList
              ariaLabel="Accuracy by subject"
              max={100}
              format="percent"
              items={progress.subjects.map((s) => ({ label: s.label || "Subject", value: s.percent, display: `${s.percent}% · ${Math.round(s.total)} questions` }))}
            />
          </Widget>
          <Widget title="Accuracy over time" description="Weekly, oldest to newest.">
            {weeks.length > 1 ? (
              <Sparkline
                data={weeks.map((w) => w.percent!)}
                summary={`Weekly accuracy: ${weeks.map((w) => `week of ${weekFmt.format(new Date(`${w.weekStart}T12:00:00+05:30`))} ${w.percent}%`).join(", ")}.`}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Practise across two weeks to see a trend.</p>
            )}
            <ul className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {progress.weekly.map((w) => (
                <li key={w.weekStart} className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                  {weekFmt.format(new Date(`${w.weekStart}T12:00:00+05:30`))}: {w.percent === null ? "—" : `${w.percent}%`}
                </li>
              ))}
            </ul>
          </Widget>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Weak topics" description="Under 60% in practice (at least 4 questions), or flagged by your mastery report.">
          {progress.weak.length === 0 ? (
            <p className="text-sm text-muted-foreground">No weak topics found yet.</p>
          ) : (
            <ul className="divide-y">
              {progress.weak.map((w) => (
                <li key={`${w.source}:${w.label}`} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{w.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.subjectName ?? "Subject"} · {w.percent}% · {w.source === "mastery" ? "mastery report" : "your practice"}
                    </p>
                  </div>
                  {studioHref && w.unitId && (
                    <Link href={`${studioHref}?tab=create&unit=${w.unitId}`} className="shrink-0 text-xs underline underline-offset-4">
                      Revise this
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Widget>
        <Widget title="Study time, last 7 days">
          <BarList
            ariaLabel="Minutes studied per day"
            items={progress.days.map((d) => ({ label: dayFmt.format(new Date(`${d.day}T12:00:00+05:30`)), value: d.minutes, display: `${d.minutes} min` }))}
          />
        </Widget>
      </div>

      {progress.attempts.length > 0 && (
        <Widget title="Recent studio quizzes">
          <ul className="divide-y">
            {progress.attempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">{a.title}</span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  {a.score}/{a.max}
                  {a.aiMax > 0 && <Badge variant="secondary">AI-checked {a.aiPoints}/{a.aiMax}</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Practice only. Nothing here goes into your marks.</p>
        </Widget>
      )}
    </div>
  );
}
