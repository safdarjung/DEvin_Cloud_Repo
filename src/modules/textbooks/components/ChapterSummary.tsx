"use client";

// Chapter summary from the book's read text: key points with the page to open.
// Staff (academics.read) and students (ai.study) for books they can read; it returns the summary and stores nothing.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";

interface Summary {
  summary: string | null;
  keyPoints: { point: string; page: number | null }[];
  pages: { from: number; to: number } | null;
  truncated: boolean;
  note: string | null;
}

export function ChapterSummary({ institutionSlug, textbookId, chapterNo }: { institutionSlug: string; textbookId: string; chapterNo: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<Summary>("/api/ai/chapter-summary", { institutionSlug, subjectTextbookId: textbookId, chapterNo });
    setBusy(false);
    if (res.ok) setResult(res.data);
    else setError(res.message);
  }

  return (
    <section aria-label={`Chapter ${chapterNo} summary`} className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? "Summarising…" : `Summarise chapter ${chapterNo}`}
      </Button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {result?.note && <p role="status" className="text-muted-foreground">{result.note}</p>}
      {result?.summary && (
        <div data-testid="chapter-summary" className="space-y-2">
          <p className="whitespace-pre-line">{result.summary}</p>
          {result.keyPoints.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {result.keyPoints.map((k, i) => (
                <li key={i}>{k.point}{k.page ? <span className="text-xs text-muted-foreground tabular-nums"> (page {k.page})</span> : null}</li>
              ))}
            </ul>
          )}
          {result.truncated && result.pages && <p className="text-xs text-muted-foreground">Covers pages {result.pages.from}-{result.pages.to}; the rest of the chapter was too long to include.</p>}
          <p className="text-xs text-muted-foreground">AI-written from your school&apos;s book text. Check it against the book.</p>
        </div>
      )}
    </section>
  );
}
