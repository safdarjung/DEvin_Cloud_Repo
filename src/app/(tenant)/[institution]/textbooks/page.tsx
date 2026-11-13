import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { SuggestNcertButton, TextbookSettings } from "@/modules/textbooks/components/TextbookSettings";
import { extractionStates, textbookSettings } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Textbooks" };

// Leaders see every taught (grade, subject); a teacher only the ones they teach
// (RLS also refuses their writes elsewhere).
export default async function TextbooksPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "resource.manage");
  const { grades, catalogue } = await textbookSettings(ctx);
  const states = await extractionStates(ctx, grades.flatMap((g) => g.subjects.flatMap((s) => s.books.filter((b) => b.file && b.source === "custom").map((b) => b.id))));

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Textbooks"
        description="Books for each grade and subject. NCERT books open on the official ncert.nic.in site and are never copied here; your own files go on curriculum units."
      />
      <div className="flex flex-wrap items-center gap-3">
        <SuggestNcertButton institutionSlug={institutionSlug} />
        <p className="text-sm text-muted-foreground">Matches each grade and subject without a book to NCERT books by class number and subject name. You can change any of them.</p>
      </div>
      {grades.length === 0 ? (
        <EmptyState title="No subjects to map yet" description="Textbooks are set per grade and subject once teachers are assigned to sections." />
      ) : (
        <TextbookSettings institutionSlug={institutionSlug} grades={grades} catalogue={catalogue} states={states} />
      )}
    </div>
  );
}
