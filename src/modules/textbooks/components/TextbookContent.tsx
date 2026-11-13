"use client";

// Phase 2 (0147/0148) on a school book: rights metadata, "Read this book"
// (text extraction), OCR for scanned pages, and a link to review the text.
// NCERT rows are link only and locked. Every action re-checks permission + RLS.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { ocrExtractionPages, retryExtraction, startExtraction } from "@/modules/content/actions";
import type { ExtractionSummary } from "@/modules/content/schemas";
import { updateTextbookMeta } from "@/modules/textbooks/actions";
import type { BookView } from "@/modules/textbooks/queries";
import { RIGHTS_STATUSES } from "@/modules/textbooks/schemas";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";
export const RIGHTS_LABEL: Record<string, string> = {
  unknown: "Not set",
  link_only: "Link only (not stored)",
  school_owned: "The school owns it",
  licensed: "Licensed to the school",
  open_licence: "Open licence",
};
const READABLE = ["school_owned", "licensed", "open_licence"];
const STATUS_LABEL: Record<ExtractionSummary["status"], string> = { queued: "Waiting to start", running: "Reading", done: "Done", partial: "Partly read", failed: "Failed" };

function MetaForm({ institutionSlug, book }: { institutionSlug: string; book: BookView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const m = book.meta;
  const locked = book.source === "ncert";
  const [f, setF] = useState({ edition: m.edition ?? "", year: m.publicationYear?.toString() ?? "", isbn: m.isbn ?? "", board: m.board ?? "", rights: m.rightsStatus, use: m.permittedUse ?? "" });
  const id = `${book.id}-meta`;
  return (
    <details className="mt-2 text-sm">
      <summary className="min-h-8 cursor-pointer py-1 text-muted-foreground">
        Edition and rights: <span className="font-medium text-foreground">{RIGHTS_LABEL[m.rightsStatus] ?? m.rightsStatus}</span>
      </summary>
      {locked ? (
        <p className="mt-2 text-xs text-muted-foreground">NCERT books are link only. The official NCERT site is the source; the text is never read or stored here.</p>
      ) : (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateTextbookMeta(institutionSlug, {
                textbookId: book.id,
                edition: f.edition,
                publicationYear: f.year.trim() ? Number(f.year) : null,
                isbn: f.isbn,
                board: f.board,
                rightsStatus: f.rights as (typeof RIGHTS_STATUSES)[number],
                permittedUse: f.use,
              });
              if (!res.ok) return void toast.error(describeActionError(res.error));
              toast.success("Book details saved");
              router.refresh();
            });
          }}
        >
          <div>
            <Label htmlFor={`${id}-edition`} className="text-xs">Edition</Label>
            <Input id={`${id}-edition`} maxLength={60} value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} disabled={pending} />
          </div>
          <div>
            <Label htmlFor={`${id}-year`} className="text-xs">Publication year</Label>
            <Input id={`${id}-year`} type="number" min={1950} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} disabled={pending} />
          </div>
          <div>
            <Label htmlFor={`${id}-isbn`} className="text-xs">ISBN</Label>
            <Input id={`${id}-isbn`} maxLength={17} value={f.isbn} onChange={(e) => setF({ ...f, isbn: e.target.value })} disabled={pending} />
          </div>
          <div>
            <Label htmlFor={`${id}-board`} className="text-xs">Board</Label>
            <Input id={`${id}-board`} maxLength={60} value={f.board} onChange={(e) => setF({ ...f, board: e.target.value })} disabled={pending} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-rights`} className="text-xs">Rights: may the school store and search this book&apos;s text?</Label>
            <select id={`${id}-rights`} className={SELECT} value={f.rights} onChange={(e) => setF({ ...f, rights: e.target.value })} disabled={pending}>
              {RIGHTS_STATUSES.filter((r) => r !== "link_only").map((r) => (
                <option key={r} value={r}>{RIGHTS_LABEL[r]}</option>
              ))}
              {f.rights === "link_only" && <option value="link_only">{RIGHTS_LABEL.link_only}</option>}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Only choose &quot;owns&quot;, &quot;licensed&quot; or &quot;open licence&quot; if the school may keep a searchable copy of the text.</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-use`} className="text-xs">Permitted use (optional)</Label>
            <Input id={`${id}-use`} maxLength={500} value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })} disabled={pending} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>Save details</Button>
          </div>
        </form>
      )}
    </details>
  );
}

function ReadCard({ institutionSlug, book, state }: { institutionSlug: string; book: BookView; state: ExtractionSummary | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ocrLeft, setOcrLeft] = useState<number | null>(null);
  const live = state?.status === "queued" || state?.status === "running";
  // A reading that did not finish in the request is finished by the job runner; check back.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [live, router]);

  const act = (task: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] }>, done: string) =>
    start(async () => {
      const res = await task();
      if (!res.ok) toast.error(describeActionError(res.error));
      else toast.success(done);
      router.refresh();
    });

  const pct = state?.pagesTotal ? Math.min(100, Math.round(((state.pagesDone + state.pagesOcr) / state.pagesTotal) * 100)) : 0;
  const needsOcr = state?.needsOcrPages.length ?? 0;

  async function runOcr(extractionId: string) {
    setOcrLeft(needsOcr);
    for (;;) {
      const res = await ocrExtractionPages(institutionSlug, { extractionId });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        break;
      }
      setOcrLeft(res.data.remaining);
      if (res.data.remaining <= 0) {
        toast.success("Scanned pages read");
        break;
      }
    }
    setOcrLeft(null);
    router.refresh();
  }

  return (
    <div className="mt-2 rounded-md border border-dashed border-border p-3 text-sm" data-testid="read-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Book text</span>
        {state && <Badge variant={state.status === "done" ? "success" : state.status === "failed" ? "destructive" : "warning"}>{STATUS_LABEL[state.status]}</Badge>}
        {state && state.chunkCount > 0 && <span className="text-xs text-muted-foreground">{state.chunkCount} passages</span>}
      </div>
      {state?.pagesTotal ? (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Pages read">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {state.pagesDone + state.pagesOcr} of {state.pagesTotal} pages read{needsOcr > 0 ? `; ${needsOcr} scanned page${needsOcr === 1 ? "" : "s"} need OCR` : ""}
          </p>
        </div>
      ) : null}
      {state?.error && <p role="alert" className="mt-1 text-xs text-destructive">{state.error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(!state || state.status === "done" || state.status === "partial") && (
          <Button type="button" size="sm" disabled={pending || ocrLeft !== null} onClick={() => act(() => startExtraction(institutionSlug, { subjectTextbookId: book.id }), "Book read")}>
            {pending && ocrLeft === null ? "Reading…" : state ? "Read again" : "Read this book"}
          </Button>
        )}
        {state?.status === "failed" && (
          <Button type="button" size="sm" disabled={pending} onClick={() => act(() => retryExtraction(institutionSlug, { extractionId: state.id }), "Book read")}>
            Try again
          </Button>
        )}
        {state && needsOcr > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={pending || ocrLeft !== null} onClick={() => void runOcr(state.id)}>
            {ocrLeft !== null ? `Reading scanned pages… ${ocrLeft} left` : `Read ${needsOcr} scanned page${needsOcr === 1 ? "" : "s"} (OCR)`}
          </Button>
        )}
        {state && state.chunkCount > 0 && (
          <Link href={`/${institutionSlug}/textbooks/${book.id}`} className="inline-flex min-h-8 items-center text-sm underline-offset-4 hover:underline">
            Review and correct text
          </Link>
        )}
      </div>
      {needsOcr > 0 && <p className="mt-1 text-xs text-muted-foreground">OCR sends scanned pages to the AI service. Schools set to keep AI on their own server cannot use it; those pages stay marked as needing OCR.</p>}
    </div>
  );
}

export function TextbookContent({ institutionSlug, book, state }: { institutionSlug: string; book: BookView; state: ExtractionSummary | null }) {
  const canRead = book.file !== null && book.source === "custom" && READABLE.includes(book.meta.rightsStatus);
  return (
    <>
      <MetaForm institutionSlug={institutionSlug} book={book} />
      {canRead && <ReadCard institutionSlug={institutionSlug} book={book} state={state} />}
      {!canRead && book.source === "custom" && book.file && (
        <p className="mt-2 text-xs text-muted-foreground">To read this book&apos;s text for search and questions, set its rights above to &quot;owns&quot;, &quot;licensed&quot; or &quot;open licence&quot;.</p>
      )}
    </>
  );
}
