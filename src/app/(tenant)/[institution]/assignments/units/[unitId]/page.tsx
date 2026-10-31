import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
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
      <PageHeader
        title={unit.title}
        description={`${grade?.display_name ?? "Grade"} · ${subject?.name ?? "Subject"}`}
        back={{ href: `/${institutionSlug}/assignments`, label: "Assignments" }}
      />
      {unit.description && (
        <Card>
          <CardContent className="text-sm">{unit.description}</CardContent>
        </Card>
      )}

      {sectionsForSubject.length === 0 ? (
        <EmptyState
          title="Can't save a quiz here yet"
          description="You don't teach this subject in any section of this grade, so a generated quiz couldn't be saved here yet."
        />
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
