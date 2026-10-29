import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { MarksEntryGrid } from "@/modules/exams/components/MarksEntryGrid";
import { getPaperMarks } from "@/modules/exams/queries";

export default async function PaperMarksPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string; paperId: string }>;
}) {
  const { institution: institutionSlug, paperId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.marks.enter");

  const paper = await getPaperMarks(ctx, paperId);
  if (!paper) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {paper.sectionLabel} · {paper.subjectName}
        </h1>
        <p className="text-muted-foreground text-sm">{paper.students.length} students enrolled.</p>
      </div>
      <MarksEntryGrid institutionSlug={institutionSlug} paper={paper} />
    </div>
  );
}
