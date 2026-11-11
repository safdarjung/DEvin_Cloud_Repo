import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { upcomingExamsForStudent } from "@/modules/exams/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { istDay } from "@/modules/practice/scoring";
import { mockAttempts, studentQuestions } from "@/modules/study/help.queries";
import { activeStudyPlan, studyProgress } from "@/modules/study/queries";

export const metadata: Metadata = { title: "Study progress" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

// 0140 guardian view, read-only: a linked child's study plan, streak, time,
// weak topics, upcoming exams, recent mock results and questions to teachers
// (all readable by a linked guardian under 0138/0140 RLS). Never the child's
// own study materials or chats: those stay private to the student.
export default async function PortalStudyProgressPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ student?: string }> }) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "student.read");
  if (ctx.membership.role !== "guardian") redirect(`/${slug}/portal`);
  if (!isModuleEnabled(ctx, "ai_student")) notFound();

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${slug}/portal/study-progress`, allParams);
  const canExams = isModuleEnabled(ctx, "exams") && hasPermission(ctx, "exam.result.read");
  const today = istDay(new Date());
  const [plan, progress, exams, mocks, questions] = await Promise.all([
    activeStudyPlan(ctx, selection.studentId),
    studyProgress(ctx, selection.studentId),
    canExams ? upcomingExamsForStudent(ctx, selection.studentId, 60) : Promise.resolve([]),
    mockAttempts(ctx, selection.studentId),
    studentQuestions(ctx, selection.studentId, 10),
  ]);
  const planDone = plan ? plan.items.filter((i) => i.done).length : 0;
  const todayItems = plan ? plan.items.filter((i) => i.day === today) : [];

  return (
    <>
      <PortalNav institutionSlug={slug} role="guardian" selection={selection} activeHref="" canStudy={false} />
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">Study progress</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {selection.studentName}&apos;s self-study: practice only, never marks. Their own notes and study material stay private to them.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="sp-time" className="min-w-0 rounded-xl border bg-card p-4">
          <h3 id="sp-time" className="text-sm font-semibold">This week</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 tabular-nums">
            <div>
              <dt className="text-xs text-muted-foreground">Streak</dt>
              <dd className="text-2xl font-semibold">{progress.streak} {progress.streak === 1 ? "day" : "days"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Time studied</dt>
              <dd className="text-2xl font-semibold">{progress.minutesThisWeek} min</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="sp-plan" className="min-w-0 rounded-xl border bg-card p-4">
          <h3 id="sp-plan" className="text-sm font-semibold">Study plan</h3>
          {plan ? (
            <>
              <p className="mt-1 text-sm">
                {plan.title}
                {plan.examLabel ? ` · for ${plan.examLabel}` : ""} · until {dateFmt.format(new Date(`${plan.targetDate}T00:00:00+05:30`))}
              </p>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {planDone} of {plan.items.length} sessions done
              </p>
              {todayItems.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {todayItems.map((i) => (
                    <li key={i.key} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">Today: {i.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{i.done ? "done" : `${i.minutes} min`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No study plan yet.</p>
          )}
        </section>

        <section aria-labelledby="sp-weak" className="min-w-0 rounded-xl border bg-card p-4">
          <h3 id="sp-weak" className="text-sm font-semibold">Topics to work on</h3>
          {progress.weak.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No weak topics found from practice yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {progress.weak.map((w) => (
                <li key={`${w.label}-${w.subjectName}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {w.label}
                    {w.subjectName ? ` · ${w.subjectName}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{w.percent}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="sp-exams" className="min-w-0 rounded-xl border bg-card p-4">
          <h3 id="sp-exams" className="text-sm font-semibold">Upcoming exams and mock results</h3>
          {exams.length === 0 && mocks.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No exams in the next 60 days and no mock exams taken yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {exams.map((e) => (
                <li key={e.paperId} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {e.examName} — {e.subjectName}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{dateFmt.format(new Date(e.scheduledAt))}</span>
                </li>
              ))}
              {mocks.map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {m.title} <Badge variant="outline">Practice</Badge>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {m.score}/{m.max} · {dateFmt.format(new Date(m.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="sp-q" className="mt-6 space-y-2">
        <h3 id="sp-q" className="text-sm font-semibold">Questions to teachers</h3>
        {questions.length === 0 ? (
          <EmptyState title="No questions yet" description="When your child asks a teacher about a study topic, it shows here with the answer." />
        ) : (
          <ul className="space-y-2">
            {questions.map((q) => (
              <li key={q.id} className="rounded-xl border p-3 text-sm">
                <p className="text-xs text-muted-foreground">{[q.subjectName, dateFmt.format(new Date(q.createdAt))].filter(Boolean).join(" · ")}</p>
                <p className="mt-1">{q.question}</p>
                <p className="mt-1 text-muted-foreground">{q.answer ? `Teacher: ${q.answer}` : "Not answered yet."}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
