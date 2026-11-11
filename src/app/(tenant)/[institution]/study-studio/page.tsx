import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { aiTaskOn } from "@/modules/ai/task-route";
import { listSubjectOptions } from "@/modules/exams/queries";
import { listAudienceSections, listMyResources, listUnitOptions } from "@/modules/resources/queries";
import { DeleteMaterialButton } from "@/modules/study/components/DeleteMaterialButton";
import { StudyCreate } from "@/modules/study/components/StudyCreate";
import { FORMAT_LABELS } from "@/modules/study/formats";
import { lessonPlanOptions, sharedMaterialEngagement } from "@/modules/study/queries";

export const metadata: Metadata = { title: "Study studio" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

// resource.manage: teachers create and share (RLS: their own material, sections they teach);
// owner/principal/admin see engagement on every teacher's shared material, read-only.
export default async function TeacherStudyStudioPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "resource.manage");
  if (!isModuleEnabled(ctx, "ai_teacher")) notFound();
  const isTeacher = ctx.membership.role === "teacher";

  const [shared, create] = await Promise.all([
    sharedMaterialEngagement(ctx, isTeacher),
    isTeacher
      ? Promise.all([listSubjectOptions(ctx), listUnitOptions(ctx), listMyResources(ctx), lessonPlanOptions(ctx), listAudienceSections(ctx)])
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Study studio"
        description={
          isTeacher
            ? "Draft summaries, flashcard decks or quizzes with AI, review and edit them, then share with your sections. Students see them marked “From your teacher”."
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
            aiOn={aiTaskOn(ctx, "teacher_study_studio")}
            subjects={create[0].map((s) => ({
              id: s.id,
              name: s.name,
              units: create[1].filter((u) => u.subjectId === s.id).map((u) => ({ id: u.id, title: u.label })),
            }))}
            resources={create[2].filter((r) => r.mine).map((r) => ({ id: r.id, title: r.title, subjectName: r.subjectName }))}
            lessonPlans={create[3]}
            sections={create[4].map((s) => ({ id: s.id, label: s.label }))}
          />
        </section>
      )}

      <section aria-labelledby="shared-heading" className="space-y-3">
        <h2 id="shared-heading" className="text-base font-semibold">
          {isTeacher ? "Shared by you" : "Shared by teachers"}
        </h2>
        {shared.length === 0 ? (
          <EmptyState title="Nothing shared yet" description={isTeacher ? "Generate something above and share it with a section." : "When teachers share study material it appears here."} />
        ) : (
          <ul className="space-y-3">
            {shared.map((m) => (
              <li key={m.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{FORMAT_LABELS[m.format]}</Badge>
                      <Badge variant="secondary">AI-generated, teacher-reviewed</Badge>
                    </p>
                    <p className="mt-1.5 text-sm font-medium">{m.title}</p>
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
