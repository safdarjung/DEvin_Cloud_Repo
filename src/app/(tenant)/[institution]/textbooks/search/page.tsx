import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { searchContent } from "@/modules/content/queries";
import { TextbookSearch } from "@/modules/textbooks/components/TextbookSearch";
import { searchableBooks } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Textbook search" };

const UUID = /^[0-9a-f-]{36}$/i;

// Full-text search over the school's own uploaded books (RLS: only books whose rights allow stored text).
export default async function TextbookSearchPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ q?: string; book?: string; chapter?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "academics.read");
  const books = await searchableBooks(ctx);
  const q = (sp.q ?? "").trim().slice(0, 200);
  const book = sp.book && UUID.test(sp.book) ? sp.book : "";
  const chapter = sp.chapter && /^\d{1,2}$/.test(sp.chapter) && Number(sp.chapter) > 0 ? sp.chapter : "";
  const hits = q ? await searchContent(ctx, { q, subjectTextbookId: book || undefined, chapterNo: chapter ? Number(chapter) : undefined, limit: 20 }) : [];
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Textbook search" description="Find a word or topic in the books your school has uploaded. Results show the page." />
      <TextbookSearch action={`/${slug}/textbooks/search`} books={books} q={q} bookId={book} chapter={chapter} hits={hits} searched={q !== ""} />
    </div>
  );
}
