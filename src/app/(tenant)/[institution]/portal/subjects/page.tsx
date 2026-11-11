import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { BarList } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { listPortalSubjects } from "@/modules/academics/portal-subjects.queries";
import { SubjectCurriculum } from "@/modules/academics/components/SubjectCurriculum";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { getStudentProfile } from "@/modules/people/queries";
import { BookList } from "@/modules/textbooks/components/BookLinks";
import { MaterialsPanel } from "@/modules/textbooks/components/MaterialsPanel";
import { classMaterials, panelItems, studentShelf, type MaterialItem } from "@/modules/textbooks/materials.queries";
import { textbooksForSection, unitChapters as loadUnitChapters } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Subjects" };

export default async function PortalSubjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  requirePermission(ctx, "academics.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/subjects`, allParams);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const sectionId = profile?.enrolment?.classSectionId;
  const subjects = sectionId ? await listPortalSubjects(ctx, sectionId) : null;
  const isStudent = ctx.membership.role === "student";
  const books = sectionId ? await textbooksForSection(ctx, sectionId) : { gradeId: null, bySubject: {} };
  const [chapters, classFiles, shelf] = await Promise.all([
    loadUnitChapters(ctx, (subjects ?? []).flatMap((s) => s.units.map((u) => u.id))),
    books.gradeId ? classMaterials(ctx, { gradeId: books.gradeId }) : Promise.resolve([] as MaterialItem[]),
    studentShelf(ctx, { studentId: selection.studentId }),
  ]);
  const viewer = { isStudent, canReview: false, canManageClass: false };
  const unfiled = shelf.filter((m) => m.subjectId === null);
  const extras = Object.fromEntries(
    (subjects ?? []).map((sub) => [
      sub.id,
      <div key={sub.id} className="mt-4 space-y-4 border-t border-border pt-3">
        <section aria-label={`${sub.name} textbooks`} className="space-y-2">
          <h3 className="text-sm font-semibold">Textbooks</h3>
          <BookList books={books.bySubject[sub.id] ?? []} empty="Your school has not set a textbook for this subject yet." />
        </section>
        <MaterialsPanel
          institutionSlug={institutionSlug}
          idPrefix={`class-${sub.id}`}
          heading="Class materials"
          description="Files your teachers shared for this subject."
          items={panelItems(classFiles.filter((m) => m.subjectId === sub.id), viewer)}
          emptyText="No class files yet."
        />
        <MaterialsPanel
          institutionSlug={institutionSlug}
          idPrefix={`mine-${sub.id}`}
          heading={isStudent ? "My files" : `${selection.studentName}'s files`}
          description={isStudent ? "Only you and your parent or guardian can see these. Suggest one to your teacher to share it with the class." : "Private to your child; read-only here."}
          items={panelItems(shelf.filter((m) => m.subjectId === sub.id), viewer)}
          emptyText="No files yet."
          upload={isStudent && books.gradeId ? { target: { gradeId: books.gradeId, subjectId: sub.id }, label: "Add a file" } : undefined}
        />
      </div>,
    ]),
  );

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/subjects"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {subjects ? (
        <FadeIn key={selection.studentId} className="space-y-4">
          {subjects.some((sub) => sub.units.length > 0) && (
            <Widget title="Syllabus coverage" description="Share of each subject's units the class has covered so far.">
              <BarList
                ariaLabel="Units covered by subject"
                max={100}
                format="percent"
                items={subjects
                  .filter((sub) => sub.units.length > 0)
                  .map((sub) => {
                    const covered = sub.units.filter((u) => u.coveredOn).length;
                    return {
                      label: sub.name,
                      value: Math.round((covered / sub.units.length) * 100),
                      display: `${covered} of ${sub.units.length}`,
                    };
                  })}
              />
            </Widget>
          )}
          {unfiled.length > 0 && (
            <Widget title="Files waiting for a subject" description="Uploaded from the study chat. Ask the assistant where to put them, or delete them.">
              <MaterialsPanel institutionSlug={institutionSlug} idPrefix="unfiled" heading="Unfiled files" items={panelItems(unfiled, viewer)} emptyText="None." />
            </Widget>
          )}
          <SubjectCurriculum subjects={subjects} unitChapters={chapters} extras={extras} />
        </FadeIn>
      ) : (
        <EmptyState title="Not enrolled in a class section" description="Ask the school office to enrol you for this year." />
      )}
    </>
  );
}
