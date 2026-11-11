"use client";

// The school's own copy of a textbook (0142): a link and a PDF beside the
// official NCERT link. SchoolPdfButton opens the PDF through a short signed
// URL for any reader; SchoolCopyEditor (leaders and the subject's teacher)
// sets the link and uploads / replaces / removes the PDF. Hiding the editor
// is UX only: every action re-checks permission and RLS decides.
import { useRef, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { formatBytes } from "@/modules/documents/upload-check";
import { getTextbookFileUrl, removeTextbookFile, setTextbookLink } from "@/modules/textbooks/files.actions";
import type { BookView } from "@/modules/textbooks/queries";
import { MAX_TEXTBOOK_FILE_MB, uploadTextbookPdf } from "./upload-textbook-file";

/** "School copy (PDF)": opens the stored PDF in a new tab via a 60-second signed URL. */
export function SchoolPdfButton({ textbookId, bookTitle }: { textbookId: string; bookTitle: string }) {
  const { institution } = useParams<{ institution: string }>();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`School copy of ${bookTitle}, PDF (opens in a new tab)`}
      className="inline-flex min-h-8 items-center gap-1 text-sm underline-offset-4 hover:underline disabled:opacity-60"
      onClick={() => {
        // Open the tab inside the click (popup blockers), point it at the signed URL afterwards.
        const tab = window.open("", "_blank");
        if (tab) tab.opener = null;
        start(async () => {
          const res = await getTextbookFileUrl(institution, { textbookId });
          if (!res.ok) {
            tab?.close();
            return void toast.error(describeActionError(res.error));
          }
          if (tab) tab.location.href = res.data.url;
          else window.location.href = res.data.url;
        });
      }}
    >
      <FileText className="size-3.5" aria-hidden /> {pending ? "Opening…" : "School copy (PDF)"}
    </button>
  );
}

/** Link + PDF controls for one textbook row. */
export function SchoolCopyEditor({ institutionSlug, book }: { institutionSlug: string; book: BookView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = book.source === "ncert" ? book.schoolUrl : book.bookUrl;
  const [url, setUrl] = useState(current ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const linkId = `${book.id}-school-link`;
  const fileId = `${book.id}-school-pdf`;

  function saveLink(next: string | null) {
    setError(null);
    start(async () => {
      const res = await setTextbookLink(institutionSlug, { textbookId: book.id, url: next });
      if (!res.ok) return setError(describeActionError(res.error));
      if (next === null) setUrl("");
      toast.success(next ? "Link saved" : "Link removed");
      router.refresh();
    });
  }

  function upload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a PDF first.");
    start(async () => {
      const res = await uploadTextbookPdf(institutionSlug, book.id, file, setProgress);
      setProgress(null);
      if (!res.ok) return setError(res.error);
      if (fileRef.current) fileRef.current.value = "";
      toast.success(book.file ? "PDF replaced" : "PDF uploaded");
      router.refresh();
    });
  }

  function removeFile() {
    if (!window.confirm(`Remove the school copy of "${book.title}"? Students and teachers lose access to the PDF.`)) return;
    setError(null);
    start(async () => {
      const res = await removeTextbookFile(institutionSlug, { textbookId: book.id });
      if (!res.ok) return setError(describeActionError(res.error));
      toast.success("PDF removed");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 grid gap-3 rounded-md border border-dashed border-border p-3 text-sm md:grid-cols-2">
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveLink(url.trim() || null);
        }}
      >
        <Label htmlFor={linkId}>{book.source === "ncert" ? "School link (https)" : "Link (https)"}</Label>
        <div className="flex flex-wrap gap-2">
          <Input id={linkId} type="url" inputMode="url" placeholder="https://" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} disabled={pending} className="min-w-0 flex-1 basis-48" />
          <Button type="submit" size="sm" disabled={pending || url.trim() === (current ?? "")}>
            {url.trim() ? "Save link" : "Clear link"}
          </Button>
        </div>
      </form>
      <form className="space-y-1" onSubmit={upload}>
        <Label htmlFor={fileId}>{book.file ? "Replace PDF" : "Upload PDF"}</Label>
        {book.file && (
          <p className="text-xs text-muted-foreground">
            Current: {book.file.name} ({formatBytes(book.file.sizeBytes)})
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input id={fileId} ref={fileRef} type="file" accept="application/pdf" disabled={pending} className="min-w-0 flex-1 basis-48" />
          <Button type="submit" size="sm" disabled={pending}>
            {progress !== null ? `Uploading ${progress}%` : book.file ? "Replace" : "Upload"}
          </Button>
          {book.file && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={removeFile}>
              Remove PDF
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PDF only, up to {MAX_TEXTBOOK_FILE_MB} MB.</p>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive md:col-span-2">
          {error}
        </p>
      )}
    </div>
  );
}
