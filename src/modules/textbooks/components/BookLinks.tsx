// A subject's textbooks with their chapters. NCERT books are links to the
// official ncert.nic.in pages and PDFs (new tab, noopener noreferrer); the
// app never fetches or stores them. Verified books link each chapter PDF;
// unverified ones send every chapter to the official book page.
import { BookOpen, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isSafeHttpsUrl } from "@/modules/resources/schemas";
import type { BookView, UnitChapterView } from "@/modules/textbooks/queries";
import { BookChapterSummary } from "./BookChapterSummary";
import { SchoolPdfButton } from "./SchoolCopy";

const EXT = { target: "_blank", rel: "noopener noreferrer" } as const;
const safe = (url: string | null) => (url && isSafeHttpsUrl(url) ? url : null);

function ChapterLink({ book, no, title, url, kind }: { book: BookView; no: number; title: string | null; url: string | null; kind: "pdf" | "page" | "none" }) {
  const label = title ? `Chapter ${no}: ${title}` : `Chapter ${no}`;
  const href = safe(url);
  if (!href || kind === "none") return <span>{label}</span>;
  return (
    <a href={href} {...EXT} className="inline-flex min-h-8 items-center gap-1 underline-offset-4 hover:underline" aria-label={`${label} of ${book.title}${kind === "page" ? ", open on NCERT" : ", PDF"} (opens in a new tab)`}>
      {label}
      <span className="text-xs text-muted-foreground">{kind === "pdf" ? "PDF" : book.source === "ncert" ? "open on NCERT" : "open"}</span>
    </a>
  );
}

/** One book: title, source line, full-book link and a collapsible chapter list. */
/** summarySlug: show a "Chapter summary" picker (only for books whose text the school holds; NCERT link-only books have none). */
export function BookCard({ book, summarySlug }: { book: BookView; summarySlug?: string }) {
  const bookHref = safe(book.bookUrl);
  const schoolHref = safe(book.schoolUrl);
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{book.title}</span>
          </p>
          {book.subtitle && <p className="text-xs text-muted-foreground">{book.subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          {/* The official NCERT link always comes first; a custom book's own link is the school's. */}
          {bookHref && (
            <a href={bookHref} {...EXT} className="inline-flex min-h-8 items-center gap-1 text-sm underline-offset-4 hover:underline" aria-label={`${book.source === "ncert" ? "Full book" : "School link"}: ${book.title} (opens in a new tab)`}>
              {book.source === "ncert" ? "Full book" : "School link"} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {schoolHref && (
            <a href={schoolHref} {...EXT} className="inline-flex min-h-8 items-center gap-1 text-sm underline-offset-4 hover:underline" aria-label={`School link: ${book.title} (opens in a new tab)`}>
              School link <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {book.file && <SchoolPdfButton textbookId={book.id} bookTitle={book.title} />}
        </div>
      </div>
      {book.source === "ncert" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Source: NCERT (ncert.nic.in). Opens the official site; not stored here.
          {!book.verified && " Chapter links open the official book page."}
        </p>
      )}
      {book.chapters.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="min-h-8 cursor-pointer py-1 text-muted-foreground">{book.chapters.length} chapters</summary>
          <ol className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {book.chapters.map((c) => (
              <li key={c.no}>
                <ChapterLink book={book} {...c} />
              </li>
            ))}
          </ol>
        </details>
      )}
      {summarySlug && book.meta.rightsStatus !== "link_only" && (
        <BookChapterSummary institutionSlug={summarySlug} textbookId={book.id} bookTitle={book.title} chapters={book.chapters} />
      )}
    </div>
  );
}

export function BookList({ books, empty = "No textbook set for this subject yet.", summarySlug }: { books: BookView[]; empty?: string; summarySlug?: string }) {
  if (books.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid grid-cols-1 gap-2">
      {books.map((b) => (
        <BookCard key={b.id} book={b} summarySlug={summarySlug} />
      ))}
    </div>
  );
}

/** "Chapter 4 of Ganita Prakash" on a curriculum unit. */
export function UnitChapterBadge({ chapter }: { chapter: UnitChapterView }) {
  const label = `Chapter ${chapter.chapterNo}${chapter.chapterTitle ? `: ${chapter.chapterTitle}` : ""} of ${chapter.bookTitle}`;
  const href = safe(chapter.url);
  return href && chapter.kind !== "none" ? (
    <a href={href} {...EXT} className="text-xs text-primary underline-offset-4 hover:underline" aria-label={`${label} (opens in a new tab)`}>
      {label}
    </a>
  ) : (
    <Badge variant="outline">{label}</Badge>
  );
}

/** Compact per-period "Book" disclosure for timetables; no layout change until opened. */
export function TimetableBookLink({ books, subjectName }: { books: BookView[] | undefined; subjectName: string }) {
  if (!books?.length) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="inline-flex min-h-6 cursor-pointer items-center gap-1 text-primary" aria-label={`Textbook for ${subjectName}`}>
        <BookOpen className="size-3" aria-hidden /> Textbook
      </summary>
      <ul className="mt-1 space-y-1">
        {books.map((b) => {
          const href = safe(b.bookUrl);
          const schoolHref = safe(b.schoolUrl);
          return (
            <li key={b.id} className="break-words">
              {href ? (
                <a href={href} {...EXT} className="underline-offset-4 hover:underline">
                  {b.title}
                </a>
              ) : (
                b.title
              )}
              {b.source === "ncert" && <span className="text-muted-foreground"> · NCERT</span>}
              {schoolHref && (
                <>
                  {" · "}
                  <a href={schoolHref} {...EXT} className="underline-offset-4 hover:underline">
                    School link
                  </a>
                </>
              )}
              {b.file && (
                <>
                  {" · "}
                  <SchoolPdfButton textbookId={b.id} bookTitle={b.title} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
