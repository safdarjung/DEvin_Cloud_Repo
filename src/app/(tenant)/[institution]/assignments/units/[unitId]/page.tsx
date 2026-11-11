import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { listSectionSubjects, listTeachableSections } from "@/modules/academics/assignments.queries";
import { QuizReviewEditor } from "@/modules/ai/components/QuizReviewEditor";
import { FadeIn } from "@/components/motion";
import { MaterialsPanel } from "@/modules/textbooks/components/MaterialsPanel";
import { BookList } from "@/modules/textbooks/components/BookLinks";
import { UnitChapterForm } from "@/modules/textbooks/components/UnitChapterForm";
import { classMaterials, panelItems, suggestionsToReview } from "@/modules/textbooks/materials.queries";
import { textbooksForGrade, unitChapters } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Unit" };

export default async function CurriculumUnitQuizPage({
  params,
}: {
  params: Promise<{ institution: string; unitId: string }>;
}) {
  const { institution: institutionSlug, unitId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "assignments");
  // Book, chapter and class files are for every reader of the unit; the AI quiz needs ai.generate.
  requirePermission(ctx, "academics.read");
  const canGenerate = hasPermission(ctx, "ai.generate");
  const canManage = hasPermission(ctx, "resource.manage");

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

  const [booksBySubject, chapters, files, suggested] = await Promise.all([
    textbooksForGrade(ctx, unit.grade_id),
    unitChapters(ctx, [unit.id]),
    classMaterials(ctx, { gradeId: unit.grade_id, subjectId: unit.subject_id, unitId: unit.id }),
    canManage ? suggestionsToReview(ctx, { gradeId: unit.grade_id, subjectId: unit.subject_id }) : Promise.resolve([]),
  ]);
  const books = booksBySubject[unit.subject_id] ?? [];
  const current = chapters[unit.id];
  const viewer = { isStudent: false, canReview: canManage, canManageClass: canManage };

  // Sections this member may save the eventual draft into: this unit's
  // grade, with the unit's subject offered there. Saving still re-checks
  // scope inside `createAssignment` (T-022) — this is just the picker.
  const teachableSections = canGenerate ? await listTeachableSections(ctx) : [];
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

      <Card>
        <CardHeader>
          <CardTitle>Textbook chapter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {current && (
            <p className="text-sm">
              Linked: Chapter {current.chapterNo}
              {current.chapterTitle ? `: ${current.chapterTitle}` : ""} of {current.bookTitle}
            </p>
          )}
          {canManage ? (
            <UnitChapterForm
              institutionSlug={institutionSlug}
              unitId={unit.id}
              books={books.map((b) => ({ id: b.id, title: b.title, chapters: b.chapters.map((c) => ({ no: c.no, title: c.title })) }))}
              current={current ? { textbookId: current.textbookId, chapterNo: current.chapterNo } : null}
            />
          ) : (
            !current && <p className="text-sm text-muted-foreground">No chapter linked yet.</p>
          )}
          <BookList books={books} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Class files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MaterialsPanel
            institutionSlug={institutionSlug}
            idPrefix="unit-files"
            heading="Shared with the class"
            description="Students of this grade who study this subject, and their parents, can open these."
            items={panelItems(files, viewer)}
            emptyText="No files for this unit yet."
            upload={canManage ? { target: { gradeId: unit.grade_id, subjectId: unit.subject_id, unitId: unit.id }, label: "Upload notes or a chapter PDF" } : undefined}
          />
          {canManage && (
            <MaterialsPanel
              institutionSlug={institutionSlug}
              idPrefix="unit-suggested"
              heading="Suggested by students"
              description="Approve to share with the class (the student stays the owner), or decline."
              items={panelItems(suggested, viewer)}
              emptyText="No suggestions waiting."
            />
          )}
        </CardContent>
      </Card>

      {!canGenerate ? null : sectionsForSubject.length === 0 ? (
        <EmptyState
          title="Can't save a quiz here yet"
          description="You don't teach this subject in any section of this grade, so a generated quiz couldn't be saved here yet."
        />
      ) : (
        <FadeIn>
        <QuizReviewEditor
          institutionSlug={institutionSlug}
          curriculumUnitId={unit.id}
          subjectId={unit.subject_id}
          defaultTitle={`${unit.title} quiz`}
          sections={sectionsForSubject}
          aiPolicy={ctx.institution.ai_policy}
        />
        </FadeIn>
      )}
    </div>
  );
}
