import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { ListPager } from "@/components/list-pager";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { ChapterSummary } from "@/modules/textbooks/components/ChapterSummary";
import { ChunkReview } from "@/modules/textbooks/components/ChunkReview";
import { bookChunks, bookHeader, CHUNK_PAGE_SIZE } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Review textbook text" };

const toInt = (v: string | undefined) => (v && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

// The text read from a school book, in page order: staff correct reading mistakes (an edit keeps the first reading).
export default async function TextbookTextPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; textbookId: string }>;
  searchParams: Promise<{ chapter?: string; page?: string }>;
}) {
  const { institution: slug, textbookId } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "resource.manage");
  if (!/^[0-9a-f-]{36}$/i.test(textbookId)) notFound();
  const header = await bookHeader(ctx, textbookId);
  if (!header) notFound();
  const chapter = sp.chapter === "none" ? "none" : toInt(sp.chapter);
  const page = toInt(sp.page) ?? 1;
  const { chunks, total, chapters } = await bookChunks(ctx, textbookId, { chapter, page });
  const base = `/${slug}/textbooks/${textbookId}`;

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={header.title} description={`${header.label}. Text read from the school's PDF. Fix reading mistakes here; search and AI questions use the corrected text.`} back={{ href: `/${slug}/textbooks`, label: "Textbooks" }} crumb={header.title} />
      <nav aria-label="Chapters" className="flex flex-wrap gap-1.5 text-sm">
        {[{ key: undefined, label: "All" }, ...chapters.map((c) => ({ key: String(c), label: `Chapter ${c}` })), { key: "none", label: "No chapter" }].map((c) => (
          <Link
            key={c.label}
            href={c.key ? `${base}?chapter=${c.key}` : base}
            aria-current={String(chapter ?? "") === (c.key ?? "") ? "page" : undefined}
            className="inline-flex min-h-8 items-center rounded-md border px-2.5 hover:bg-muted aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {c.label}
          </Link>
        ))}
      </nav>
      {typeof chapter === "number" && chunks.length > 0 && hasPermission(ctx, "question.manage") && <ChapterSummary key={chapter} institutionSlug={slug} textbookId={textbookId} chapterNo={chapter} />}
      {chunks.length === 0 ? (
        <EmptyState title="No text here" description="Read the book from the Textbooks page first, or pick another chapter." />
      ) : (
        <ChunkReview institutionSlug={slug} chunks={chunks} />
      )}
      <ListPager basePath={base} params={{ chapter: chapter === undefined ? undefined : String(chapter) }} page={page} total={total} pageSize={CHUNK_PAGE_SIZE} noun="passages" />
    </div>
  );
}
