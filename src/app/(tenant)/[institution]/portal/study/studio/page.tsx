import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { uuid } from "@/lib/schemas/common";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import { upcomingExamsForStudent } from "@/modules/exams/queries";
import { getStudentProfile } from "@/modules/people/queries";
import { istDay } from "@/modules/practice/scoring";
import { portalResources } from "@/modules/resources/queries";
import { DeckDrill } from "@/modules/study/components/DeckDrill";
import { DeleteMaterialButton } from "@/modules/study/components/DeleteMaterialButton";
import { AiLabel, MaterialView } from "@/modules/study/components/MaterialView";
import { QuizRunner } from "@/modules/study/components/QuizRunner";
import { StudyCreate } from "@/modules/study/components/StudyCreate";
import { PlanBuilder, PlanView } from "@/modules/study/components/StudyPlan";
import { StudyProgressView } from "@/modules/study/components/StudyProgressView";
import { FORMAT_LABELS, type Difficulty, type QuizQuestion } from "@/modules/study/formats";
import { activeStudyPlan, deckForDrill, deckSummaries, getStudyMaterial, studyLibrary, studyProgress } from "@/modules/study/queries";

export const metadata: Metadata = { title: "Study studio" };

const TABS = [
  { key: "create", label: "Create" },
  { key: "library", label: "Library" },
  { key: "cards", label: "Flashcards" },
  { key: "quiz", label: "Quizzes" },
  { key: "plan", label: "Plan" },
  { key: "progress", label: "Progress" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const validId = (v: string | undefined) => (v && uuid.safeParse(v).success ? v : undefined);

async function mySubjects(ctx: TenantContext, studentId: string) {
  const profile = await getStudentProfile(ctx, studentId);
  const sectionId = profile?.enrolment?.classSectionId;
  const subjects = sectionId ? await listPortalSubjects(ctx, sectionId) : [];
  return subjects.map((s) => ({ id: s.id, name: s.name, units: s.units.map((u) => ({ id: u.id, title: u.title })) }));
}

// Student-only (ai.study). Guardians read their child's plan and progress under RLS but have no studio page.
export default async function StudyStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ tab?: string; item?: string; deck?: string; quiz?: string; unit?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "ai.study");
  if (!isModuleEnabled(ctx, "ai_student")) notFound();
  const studentId = ctx.membership.studentId;
  if (!studentId) redirect(`/${slug}/portal`);

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "create";
  const base = `/${slug}/portal/study/studio`;
  const today = istDay(new Date());

  let body: React.ReactNode;
  if (tab === "create") {
    const [subjects, resources] = await Promise.all([
      mySubjects(ctx, studentId),
      isModuleEnabled(ctx, "resources") && hasPermission(ctx, "resource.read") ? portalResources(ctx, studentId) : Promise.resolve([]),
    ]);
    body = (
      <StudyCreate
        audience="student"
        institutionSlug={slug}
        aiOn={isAiCapabilityEnabled(ctx, "study_studio")}
        subjects={subjects}
        resources={resources.map((r) => ({ id: r.id, title: r.title, subjectName: r.subjectName }))}
        initialUnitId={validId(sp.unit)}
      />
    );
  } else if (tab === "library") {
    const itemId = validId(sp.item);
    const item = itemId ? await getStudyMaterial(ctx, itemId) : null;
    if (item) {
      body = (
        <article className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AiLabel fromTeacher={item.fromTeacher} />
            <div className="flex gap-2">
              {item.format === "flashcards" && (
                <Link href={`${base}?tab=cards&deck=${item.id}`} className={buttonVariants({ size: "sm" })}>
                  Drill
                </Link>
              )}
              {item.format === "quiz" && (
                <Link href={`${base}?tab=quiz&quiz=${item.id}`} className={buttonVariants({ size: "sm" })}>
                  Take quiz
                </Link>
              )}
              {item.isMine && <DeleteMaterialButton institutionSlug={slug} materialId={item.id} audience="student" afterHref={`${base}?tab=library`} />}
            </div>
          </div>
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <p className="text-xs text-muted-foreground">
            {[FORMAT_LABELS[item.format], item.subjectName, dateFmt.format(new Date(item.createdAt))].filter(Boolean).join(" · ")}
          </p>
          <div className="rounded-xl border bg-card p-4">
            {item.format === "quiz" ? <p className="text-sm text-muted-foreground">Take the quiz to see the questions.</p> : <MaterialView format={item.format} content={item.content} />}
          </div>
          <Link href={`${base}?tab=library`} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
            Back to library
          </Link>
        </article>
      );
    } else {
      const items = await studyLibrary(ctx);
      body =
        items.length === 0 ? (
          <EmptyState title="Your library is empty" description="Make a summary, flashcards or a quiz in Create. Material your teacher shares shows up here too." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((m) => (
              <li key={m.id}>
                <Link
                  href={m.format === "flashcards" ? `${base}?tab=cards&deck=${m.id}` : m.format === "quiz" ? `${base}?tab=quiz&quiz=${m.id}` : `${base}?tab=library&item=${m.id}`}
                  className="block min-h-16 rounded-xl border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{FORMAT_LABELS[m.format]}</Badge>
                    {m.fromTeacher && <Badge>From your teacher</Badge>}
                  </span>
                  <span className="mt-1.5 block truncate text-sm font-medium">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">{[m.subjectName, dateFmt.format(new Date(m.createdAt))].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        );
    }
  } else if (tab === "cards") {
    const deckId = validId(sp.deck);
    const deck = deckId ? await deckForDrill(ctx, studentId, deckId) : null;
    if (deck) {
      body = (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{deck.title}</h2>
            <AiLabel fromTeacher={deck.fromTeacher} />
          </div>
          <DeckDrill institutionSlug={slug} deckId={deck.id} subjectId={deck.subjectId} cards={deck.cards} queue={deck.queue} backHref={`${base}?tab=cards`} />
        </div>
      );
    } else {
      const decks = await deckSummaries(ctx, studentId);
      const due = decks.reduce((n, d) => n + d.due, 0);
      body =
        decks.length === 0 ? (
          <EmptyState title="No flashcard decks yet" description="Choose Flashcard deck in Create to make one from a unit or your notes." />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground tabular-nums">{due ? `${due} cards due today across your decks.` : "Nothing due today. New cards are ready whenever you are."}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {decks.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {d.cards} cards · {d.due} due · {d.fresh} new{d.fromTeacher ? " · from your teacher" : ""}
                    </p>
                  </div>
                  <Link href={`${base}?tab=cards&deck=${d.id}`} className={buttonVariants({ size: "sm", variant: d.due ? "default" : "outline" })}>
                    Drill
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
    }
  } else if (tab === "quiz") {
    const quizId = validId(sp.quiz);
    const quiz = quizId ? await getStudyMaterial(ctx, quizId) : null;
    if (quiz && quiz.format === "quiz") {
      const content = quiz.content as { difficulty: Difficulty; questions: QuizQuestion[] };
      body = (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{quiz.title}</h2>
            <AiLabel fromTeacher={quiz.fromTeacher} />
          </div>
          <QuizRunner
            institutionSlug={slug}
            materialId={quiz.id}
            title={quiz.title}
            subjectId={quiz.subjectId}
            unitId={quiz.unitId}
            difficulty={content.difficulty}
            questions={content.questions}
            backHref={`${base}?tab=quiz`}
          />
        </div>
      );
    } else {
      const [items, progress] = await Promise.all([studyLibrary(ctx), studyProgress(ctx, studentId)]);
      const quizzes = items.filter((m) => m.format === "quiz");
      body = (
        <div className="space-y-4">
          {quizzes.length === 0 ? (
            <EmptyState
              title="No quizzes yet"
              description="Choose Quiz in Create: multiple choice, true/false and short answers, 5 to 15 questions."
              action={
                <Link href={`${base}?tab=create`} className={buttonVariants({ size: "sm" })}>
                  Make a quiz
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {quizzes.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.title}</p>
                    <p className="text-xs text-muted-foreground">{[q.subjectName, q.fromTeacher ? "from your teacher" : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Link href={`${base}?tab=quiz&quiz=${q.id}`} className={buttonVariants({ size: "sm" })}>
                    Take
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {progress.attempts.length > 0 && (
            <section aria-labelledby="recent-attempts">
              <h3 id="recent-attempts" className="mb-2 text-sm font-semibold">
                Recent attempts
              </h3>
              <ul className="divide-y rounded-xl border">
                {progress.attempts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{a.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {a.score}/{a.max}
                      {a.aiMax ? ` · AI-checked ${a.aiPoints}/${a.aiMax}` : ""} · {dateFmt.format(new Date(a.createdAt))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">Practice only. Nothing here goes into your marks.</p>
            </section>
          )}
        </div>
      );
    }
  } else if (tab === "plan") {
    const canExams = isModuleEnabled(ctx, "exams") && hasPermission(ctx, "exam.result.read");
    const [plan, exams, subjects, progress] = await Promise.all([
      activeStudyPlan(ctx, studentId),
      canExams ? upcomingExamsForStudent(ctx, studentId, 120) : Promise.resolve([]),
      mySubjects(ctx, studentId),
      studyProgress(ctx, studentId),
    ]);
    body = (
      <div className="space-y-6">
        {plan ? (
          <PlanView institutionSlug={slug} plan={plan} today={today} />
        ) : (
          <p className="text-sm text-muted-foreground">No plan yet. Pick an exam and your topics; weak topics get more time.</p>
        )}
        <PlanBuilder
          institutionSlug={slug}
          today={today}
          exams={exams
            .filter((e) => istDay(e.scheduledAt) > today)
            .map((e) => ({ id: e.paperId, label: `${e.examName} — ${e.subjectName}`, date: istDay(e.scheduledAt), subjectName: e.subjectName }))}
          subjects={subjects}
          weakUnitIds={progress.weak.flatMap((w) => (w.unitId ? [w.unitId] : []))}
          timetableOn={isModuleEnabled(ctx, "timetable")}
          hasPlan={Boolean(plan)}
        />
      </div>
    );
  } else {
    const [progress, decks] = await Promise.all([studyProgress(ctx, studentId), deckSummaries(ctx, studentId)]);
    body = <StudyProgressView progress={progress} dueCards={decks.reduce((n, d) => n + d.due, 0)} studioHref={base} />;
  }

  return (
    <>
      <PageHeader
        title="Study studio"
        description="Summaries, flashcards, quizzes and a plan, made from your own units and notes. AI-made study help can contain mistakes."
        back={{ href: `/${slug}/portal`, label: "Back" }}
        compact
      />
      <nav aria-label="Study studio sections" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`${base}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                  tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {body}
    </>
  );
}
