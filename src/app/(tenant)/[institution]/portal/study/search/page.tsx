import type { Metadata } from "next";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { searchContent } from "@/modules/content/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { TextbookSearch } from "@/modules/textbooks/components/TextbookSearch";
import { searchableBooks } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Textbook search" };

const UUID = /^[0-9a-f-]{36}$/i;

// Students (and guardians, per child) search the books of their own class; RLS limits rows to the child's grade and subjects.
export default async function PortalTextbookSearchPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ q?: string; book?: string; chapter?: string; student?: string }> }) {
  const { institution: slug } = await params;
  const all = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "academics.read");
  const selection = await resolvePortalSelection(ctx, all.student, `/${slug}/portal/study/search`, all);
  const books = await searchableBooks(ctx);
  const q = (all.q ?? "").trim().slice(0, 200);
  const book = all.book && UUID.test(all.book) ? all.book : "";
  const chapter = all.chapter && /^\d{1,2}$/.test(all.chapter) && Number(all.chapter) > 0 ? all.chapter : "";
  const hits = q ? await searchContent(ctx, { q, subjectTextbookId: book || undefined, chapterNo: chapter ? Number(chapter) : undefined, limit: 20 }) : [];
  return (
    <>
      <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} description="Find a word or topic in your class books. Each result shows the page to open in your book." />
      <TextbookSearch action={`/${slug}/portal/study/search`} books={books} q={q} bookId={book} chapter={chapter} hits={hits} searched={q !== ""} />
    </>
  );
}
