"use client";

// Student subject view: pick a chapter of a school-held book, then summarise it (ChapterSummary).
import { useState } from "react";
import type { ChapterView } from "@/modules/textbooks/queries";
import { ChapterSummary } from "./ChapterSummary";

/** Student subject view: pick a chapter of a school-held book, then summarise it. */
export function BookChapterSummary({ institutionSlug, textbookId, bookTitle, chapters }: { institutionSlug: string; textbookId: string; bookTitle: string; chapters: ChapterView[] }) {
  const [chapterNo, setChapterNo] = useState<number | null>(null);
  if (chapters.length === 0) return null;
  return (
    <details className="mt-2 text-sm" data-testid="book-chapter-summary">
      <summary className="inline-flex min-h-8 cursor-pointer items-center text-primary">Chapter summary</summary>
      <div className="mt-2 space-y-2">
        <select
          aria-label={`Chapter of ${bookTitle} to summarise`}
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={chapterNo ?? ""}
          onChange={(e) => setChapterNo(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Choose a chapter</option>
          {chapters.map((c) => <option key={c.no} value={c.no}>Chapter {c.no}{c.title ? `: ${c.title}` : ""}</option>)}
        </select>
        {chapterNo !== null && <ChapterSummary key={chapterNo} institutionSlug={institutionSlug} textbookId={textbookId} chapterNo={chapterNo} />}
      </div>
    </details>
  );
}
