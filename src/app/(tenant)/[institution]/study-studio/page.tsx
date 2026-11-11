import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { uuid } from "@/lib/schemas/common";
import { aiTaskOn } from "@/modules/ai/task-route";
import { listSubjectOptions } from "@/modules/exams/queries";
import { listAudienceSections, listMyResources, listUnitOptions } from "@/modules/resources/queries";
import { AssignHomework } from "@/modules/study/components/AssignHomework";
import { DeleteMaterialButton } from "@/modules/study/components/DeleteMaterialButton";
import { LanguageVersions } from "@/modules/study/components/LanguageVersions";
import { MaterialView } from "@/modules/study/components/MaterialView";
import { QuestionInbox } from "@/modules/study/components/QuestionInbox";
import { RevisionPack } from "@/modules/study/components/RevisionPack";
import { StudyCreate } from "@/modules/study/components/StudyCreate";
import { FORMAT_LABELS } from "@/modules/study/formats";
import { hasFileConsent, materialVariants, studyFileOptions, taughtPairs, teacherQuestionInbox } from "@/modules/study/help.queries";
import { getStudyMaterial, lessonPlanOptions, sharedMaterialEngagement, studyLibrary } from "@/modules/study/queries";

export const metadata: Metadata = { title: "Study studio" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const validId = (v: string | undefined) => (v && uuid.safeParse(v).success ? v : undefined);

// resource.manage: teachers create and share (RLS: their own material, sections they teach);
// owner/principal/admin see engagement on every teacher's shared material, read-only.
// 0140: files, worksheets, class revision packs, homework, Hindi versions and the students' question inbox.
export default async function TeacherStudyStudioPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ file?: string; item?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "resource.manage");
  if (!isModuleEnabled(ctx, "ai_teacher")) notFound();
  const isTeacher = ctx.membership.role === "teacher";
  const base = `/${slug}/study-studio`;
  const aiOn = aiTaskOn(ctx, "teacher_study_studio");
  const canAssign = isModuleEnabled(ctx, "assignments") && hasPermission(ctx, "assignment.manage");

  const itemId = validId(sp.item);
  const item = isTeacher && itemId ? await getStudyMaterial(ctx, itemId) : null;
  if (item && item.isMine) {
    const [versions, pairs] = await Promise.all([materialVariants(ctx, item.variantOf ?? item.id), taughtPairs(ctx)]);
    return (
      <>
        <PageHeader title={item.title} description={[FORMAT_LABELS[item.format], item.subjectName, dateFmt.format(new Date(item.createdAt))].filter(Boolean).join(" · ")} back={{ href: base, label: "Study studio" }} />
        <div className="space-y-4">
          <Badge variant="secondary">AI-generated, teacher-reviewed</Badge>
          <LanguageVersions audience="teacher" institutionSlug={slug} current={{ id: item.id, language: item.language }} versions={versions} hrefFor={`${base}?item=`} canTranslate={aiOn} />
          <div className="rounded-xl border bg-card p-4">
            <MaterialView format={item.format} content={item.content} showQuizAnswers />
          </div>
          {canAssign && <AssignHomework institutionSlug={slug} materialId={item.id} isWorksheet={item.format === "worksheet"} subjectId={item.subjectId} pairs={pairs} />}
        </div>
      </>
    );
  }

  const [shared, create, mine, inbox, files, consent, pairs] = await Promise.all([
    sharedMaterialEngagement(ctx, isTeacher),
    isTeacher
      ? Promise.all([listSubjectOptions(ctx), listUnitOptions(ctx), listMyResources(ctx), lessonPlanOptions(ctx), listAudienceSections(ctx)])
      : Promise.resolve(null),
    isTeacher ? studyLibrary(ctx).then((rows) => rows.filter((r) => r.isMine)) : Promise.resolve([]),
    isTeacher ? teacherQuestionInbox(ctx) : Promise.resolve([]),
    isTeacher ? studyFileOptions(ctx) : Promise.resolve([]),
    isTeacher ? hasFileConsent(ctx) : Promise.resolve(false),
    isTeacher ? taughtPairs(ctx) : Promise.resolve([]),
  ]);
  const worksheets = mine.filter((m) => m.format === "worksheet");
  // Worksheets are never shared to a section (their key stays with the teacher): listed above, not here.
  const sharedItems = shared.filter((m) => m.format !== "worksheet");
  const sections = [...new Map(pairs.map((p) => [p.sectionId, { id: p.sectionId, label: p.sectionLabel }])).values()];

  return (
    <>
      <PageHeader
        title="Study studio"
        description={
          isTeacher
            ? "Draft summaries, flashcards, quizzes or worksheets with AI from a unit, your notes or a class file; review them, then share or assign them. Students see them marked “From your teacher”."
            : "Study material teachers have shared, with engagement per section. Counts and percentages only."
        }
      />
      {create && (
        <section aria-labelledby="create-heading" className="mb-8 rounded-2xl border bg-card p-4 sm:p-5">
          <h2 id="create-heading" className="mb-4 text-base font-semibold">
            Create study material
          </h2>
          <StudyCreate
            audience="teacher"
            institutionSlug={slug}
            aiOn={aiOn}
            subjects={create[0].map((s) => ({
              id: s.id,
              name: s.name,
              units: create[1].filter((u) => u.subjectId === s.id).map((u) => ({ id: u.id, title: u.label })),
            }))}
            resources={create[2].filter((r) => r.mine).map((r) => ({ id: r.id, title: r.title, subjectName: r.subjectName }))}
            lessonPlans={create[3]}
            sections={create[4].map((s) => ({ id: s.id, label: s.label }))}
            files={files.map((f) => ({ id: f.id, title: f.title, fileName: f.fileName, kind: f.kind, tooBig: f.tooBig }))}
            fileConsent={consent}
            initialFileId={validId(sp.file)}
          />
        </section>
      )}

      {isTeacher && aiOn && (
        <section aria-labelledby="pack-heading" className="mb-8 rounded-2xl border bg-card p-4 sm:p-5">
          <h2 id="pack-heading" className="mb-3 text-base font-semibold">
            Class revision pack
          </h2>
          <RevisionPack audience="teacher" institutionSlug={slug} sections={sections} />
        </section>
      )}

      {isTeacher && (
        <section aria-labelledby="inbox-heading" className="mb-8 space-y-3">
          <h2 id="inbox-heading" className="text-base font-semibold">
            Questions from students{inbox.some((q) => !q.answer) ? ` (${inbox.filter((q) => !q.answer).length} new)` : ""}
          </h2>
          <QuestionInbox institutionSlug={slug} rows={inbox} />
        </section>
      )}

      {isTeacher && (
        <section aria-labelledby="ws-heading" className="mb-8 space-y-3">
          <h2 id="ws-heading" className="text-base font-semibold">
            Your worksheets
          </h2>
          {worksheets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Choose Worksheet in Create to draft one at three levels with an answer key.</p>
          ) : (
            <ul className="space-y-2">
              {worksheets.map((w) => (
                <li key={w.id} className="rounded-xl border bg-card p-3">
                  <Link href={`${base}?item=${w.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                    {w.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[w.subjectName, w.language === "hi" ? "हिन्दी" : null, dateFmt.format(new Date(w.createdAt))].filter(Boolean).join(" · ")}</p>
                  {canAssign && (
                    <div className="mt-2">
                      <AssignHomework institutionSlug={slug} materialId={w.id} isWorksheet subjectId={w.subjectId} pairs={pairs} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="shared-heading" className="space-y-3">
        <h2 id="shared-heading" className="text-base font-semibold">
          {isTeacher ? "Shared by you" : "Shared by teachers"}
        </h2>
        {sharedItems.length === 0 ? (
          <EmptyState title="Nothing shared yet" description={isTeacher ? "Generate something above and share it with a section." : "When teachers share study material it appears here."} />
        ) : (
          <ul className="space-y-3">
            {sharedItems.map((m) => (
              <li key={m.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{FORMAT_LABELS[m.format]}</Badge>
                      <Badge variant="secondary">AI-generated, teacher-reviewed</Badge>
                    </p>
                    {isTeacher ? (
                      <Link href={`${base}?item=${m.id}`} className="mt-1.5 block text-sm font-medium underline-offset-4 hover:underline">
                        {m.title}
                      </Link>
                    ) : (
                      <p className="mt-1.5 text-sm font-medium">{m.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{[m.subjectName, dateFmt.format(new Date(m.createdAt))].filter(Boolean).join(" · ")}</p>
                  </div>
                  {isTeacher && <DeleteMaterialButton institutionSlug={slug} materialId={m.id} audience="teacher" />}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[22rem] text-left text-sm">
                    <caption className="sr-only">Engagement by section</caption>
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-medium">Section</th>
                        <th scope="col" className="py-1 pr-3 font-medium">Students engaged</th>
                        <th scope="col" className="py-1 pr-3 font-medium">Quiz attempts</th>
                        <th scope="col" className="py-1 font-medium">Average</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {m.sections.map((s) => (
                        <tr key={s.sectionId} className="border-t">
                          <td className="py-1.5 pr-3">{s.sectionLabel}</td>
                          <td className="py-1.5 pr-3">
                            {s.engaged}/{s.enrolled}
                            {s.enrolled ? ` (${Math.round((s.engaged / s.enrolled) * 100)}%)` : ""}
                          </td>
                          <td className="py-1.5 pr-3">{m.format === "quiz" ? s.attempts : "—"}</td>
                          <td className="py-1.5">{s.avgPercent === null ? "—" : `${s.avgPercent}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {m.weakSpots.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">{m.format === "quiz" ? "Hardest questions" : "Most-missed cards"}</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {m.weakSpots.map((w) => (
                        <li key={w.label} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">{w.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{w.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Practice data only: quiz scores here are never marks.</p>
      </section>
    </>
  );
}
