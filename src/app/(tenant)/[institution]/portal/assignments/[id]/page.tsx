import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { FadeIn } from "@/components/motion";
import { ProgressBar } from "@/components/widgets/viz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { getAssignment } from "@/modules/academics/assignments.queries";
import { AssignmentSubmitForm } from "@/modules/academics/components/AssignmentSubmitForm";
import { QuizContentView } from "@/modules/academics/components/QuizContentView";
import { mySubmissions } from "@/modules/academics/submissions.queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Assignment" };

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function savedContent(content: unknown): { text: string; answers: string[] } {
  const c = (content ?? {}) as { text?: unknown; answers?: unknown };
  return {
    text: typeof c.text === "string" ? c.text : "",
    answers: Array.isArray(c.answers) ? c.answers.filter((a): a is string => typeof a === "string") : [],
  };
}

export default async function PortalAssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; id: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "assignments");
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/assignments/${id}`, allParams);
  const [assignment, submissions] = await Promise.all([getAssignment(ctx, id), mySubmissions(ctx, selection.studentId)]);
  // mySubmissions only lists this student's section assignments, so a miss is also a scope check.
  const mine = submissions.find((s) => s.assignmentId === id);
  if (!assignment || !mine) notFound();

  const isStudent = ctx.membership.role === "student" && hasPermission(ctx, "assignment.submit");
  const graded = mine.state === "graded";
  const closed = assignment.status === "closed";
  const saved = savedContent(mine.content);
  const q = `?student=${selection.studentId}`;

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/assignments"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <div className="space-y-4">
        <PageHeader
          title={assignment.title}
          description={assignment.dueAt ? `Due ${fmt.format(new Date(assignment.dueAt))}` : undefined}
          back={{ href: `/${institutionSlug}/portal/assignments${q}`, label: "Assignments" }}
          actions={
            <Badge variant={graded ? "success" : mine.state === "submitted" ? "info" : closed ? "outline" : "warning"}>
              {graded ? "Graded" : mine.state === "submitted" ? "Submitted" : closed ? "Closed" : "Not submitted"}
            </Badge>
          }
        />

        <FadeIn className="grid gap-4 lg:grid-cols-3">
        <div className={`min-w-0 space-y-4 ${mine.state === "not_submitted" ? "lg:col-span-3 lg:max-w-3xl" : "lg:col-span-2"}`}>
        {assignment.instructions && (
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm">{assignment.instructions}</CardContent>
          </Card>
        )}

        {isStudent && !graded && !closed ? (
          <Card>
            <CardHeader>
              <CardTitle>{mine.state === "submitted" ? "Update your submission" : "Submit your work"}</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentSubmitForm
                institutionSlug={institutionSlug}
                assignmentId={assignment.id}
                questions={assignment.content?.questions ?? null}
                initialText={saved.text}
                initialAnswers={saved.answers}
                resubmit={mine.state === "submitted"}
              />
            </CardContent>
          </Card>
        ) : mine.state === "not_submitted" && closed ? (
          <p className="text-sm text-muted-foreground">This assignment is closed and no submission was made.</p>
        ) : assignment.content && !isStudent ? (
          <Card>
            <CardHeader>
              <CardTitle>Quiz</CardTitle>
            </CardHeader>
            <CardContent>
              <QuizContentView content={assignment.content} showAnswers={false} />
            </CardContent>
          </Card>
        ) : null}
        </div>
        {mine.state !== "not_submitted" && (
        <aside className="order-first min-w-0 space-y-4 lg:order-none">
          <Card>
            <CardHeader>
              <CardTitle>{graded ? "Your result" : "Your submission"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {mine.submittedAt ? `Submitted ${fmt.format(new Date(mine.submittedAt))}` : null}
                {mine.isLate ? " (late)" : ""}
                {mine.attempt > 1 ? ` · attempt ${mine.attempt}` : ""}
              </p>
              {graded && mine.score !== null && mine.maxScore !== null && (
                <>
                  <p className="text-2xl font-semibold tabular-nums">
                    {mine.score}/{mine.maxScore}
                  </p>
                  <ProgressBar label="Score" value={mine.score} max={mine.maxScore} tone="success" />
                </>
              )}
              {graded && (mine.feedback ? <p className="whitespace-pre-line">{mine.feedback}</p> : <p className="text-muted-foreground">No feedback from your teacher.</p>)}
            </CardContent>
          </Card>
        </aside>
        )}
        </FadeIn>
      </div>
    </>
  );
}
