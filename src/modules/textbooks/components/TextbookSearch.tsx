import type { ReactNode } from "react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContentSearchHit } from "@/modules/content/schemas";
import type { SearchableBook } from "@/modules/textbooks/queries";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";

/** The snippet is plain text with matches wrapped in « »; rendered as <mark>, never as HTML. */
export function Highlighted({ snippet }: { snippet: string }) {
  const parts: ReactNode[] = [];
  snippet.split("«").forEach((piece, i) => {
    if (i === 0) return void parts.push(piece);
    const [hit, ...rest] = piece.split("»");
    parts.push(<mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-foreground">{hit}</mark>, rest.join("»"));
  });
  return <>{parts}</>;
}

/** GET form + results; the page runs content.search on the server so the URL is shareable. */
export function TextbookSearch({
  action,
  books,
  q,
  bookId,
  chapter,
  hits,
  searched,
}: {
  action: string;
  books: SearchableBook[];
  q: string;
  bookId: string;
  chapter: string;
  hits: ContentSearchHit[];
  searched: boolean;
}) {
  return (
    <div className="space-y-4">
      <form action={action} method="get" role="search" className="grid gap-2 sm:grid-cols-[1fr_14rem_8rem_auto]">
        <Input name="q" type="search" required maxLength={200} defaultValue={q} placeholder="Search your textbooks, e.g. photosynthesis" aria-label="Search text" />
        <select name="book" defaultValue={bookId} className={SELECT} aria-label="Book">
          <option value="">All books</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.label}: {b.title}</option>
          ))}
        </select>
        <Input name="chapter" type="number" min={1} max={99} defaultValue={chapter} placeholder="Chapter" aria-label="Chapter number" />
        <Button type="submit">Search</Button>
      </form>
      {books.length === 0 && <EmptyState title="No textbooks to search yet" description="Search works on books the school has uploaded and read. Ask your school to add yours." />}
      {searched && books.length > 0 && (
        hits.length === 0 ? (
          <EmptyState title="Nothing found" description="Try a different word, or remove the book and chapter filters." />
        ) : (
          <ul className="space-y-2" aria-label="Search results">
            {hits.map((h) => (
              <li key={h.chunkId} data-testid="search-hit" className="rounded-md border bg-card p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{h.bookTitle ?? "Textbook"}</span>
                  {h.chapterNo !== null && <> · Chapter {h.chapterNo}</>}
                  {h.heading && <> · {h.heading}</>}
                  {" · "}
                  <span className="tabular-nums">{h.pageFrom === h.pageTo ? `page ${h.pageFrom}` : `pages ${h.pageFrom}-${h.pageTo}`}</span>
                </p>
                <p className="mt-1 whitespace-pre-line"><Highlighted snippet={h.snippet} /></p>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
