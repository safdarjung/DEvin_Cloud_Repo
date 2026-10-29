import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { listSectionSubjects, listTeachableSections } from "@/modules/academics/assignments.queries";
import { QuizReviewEditor } from "@/modules/ai/components/QuizReviewEditor";

export default async function CurriculumUnitQuizPage({
  params,
}: {
  params: Promise<{ institution: string; unitId: string }>;
}) {
  const { institution: institutionSlug, unitId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.generate");

  const supabase = await createClient();
  const { data: unit, error } = await supabase
    .from("curriculum_units")
    .select("id, title, description, grade_id, subject_id")
    .eq("id", unitId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!unit) notFound();

  const [{ data: grade }, { data: subject }] = await Promise.all([
    supabase.from("grades").select("display_name").eq("id", unit.grade_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", unit.subject_id).maybeSingle(),
  ]);

  // Sections this member may save the eventual draft into: this unit's
  // grade, with the unit's subject offered there. Saving still re-checks
  // scope inside `createAssignment` (T-022) — this is just the picker.
  const teachableSections = await listTeachableSections(ctx);
  const candidateSections = teachableSections.filter((section) => section.gradeId === unit.grade_id);
  const sectionsForSubject = (
    await Promise.all(
      candidateSections.map(async (section) => ({
        section,
        subjects: await listSectionSubjects(ctx, section.id),
      })),
    )
  )
    .filter(({ subjects }) => subjects.some((candidate) => candidate.id === unit.subject_id))
    .map(({ section }) => ({ id: section.id, label: section.label }));

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{unit.title}</h1>
        <p className="text-muted-foreground text-sm">
          {grade?.display_name ?? "Grade"} · {subject?.name ?? "Subject"}
        </p>
        {unit.description && <p className="mt-2 text-sm">{unit.description}</p>}
      </div>

      {sectionsForSubject.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You don&apos;t teach this subject in any section of this grade, so a generated quiz couldn&apos;t be saved
          here yet.
        </p>
      ) : (
        <QuizReviewEditor
          institutionSlug={institutionSlug}
          curriculumUnitId={unit.id}
          subjectId={unit.subject_id}
          defaultTitle={`${unit.title} quiz`}
          sections={sectionsForSubject}
          aiPolicy={ctx.institution.ai_policy}
        />
      )}
    </div>
  );
}
