import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { MarksEntryGrid } from "@/modules/exams/components/MarksEntryGrid";
import { getPaperMarks } from "@/modules/exams/queries";

export default async function PaperMarksPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string; paperId: string }>;
}) {
  const { institution: institutionSlug, examId, paperId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.marks.enter");

  const paper = await getPaperMarks(ctx, paperId);
  if (!paper) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${paper.sectionLabel} · ${paper.subjectName}`}
        description={`${paper.students.length} students enrolled.`}
        back={{ href: `/${institutionSlug}/exams/${examId}`, label: "Exam" }}
      />
      <MarksEntryGrid institutionSlug={institutionSlug} paper={paper} />
    </div>
  );
}
