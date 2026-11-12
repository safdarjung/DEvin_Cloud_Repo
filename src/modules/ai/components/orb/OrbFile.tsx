"use client";

// Reading a file in the orb: a paperclip in the message box uploads a PDF or photo to the
// person's own study shelf (the Study page's path), a bar over the box shows it with
// Summarize / Mind map / Flowchart, and typed questions then go to the file. The AI reads the
// file only after the person agrees once (file-reading consent); nothing is saved from the answer.
import { useRef } from "react";
import { FileText, Loader2, Network, Paperclip, Workflow, X } from "lucide-react";
import type { FileAnswerResponse } from "@/modules/ai/explain/schemas";

export interface AttachedFile {
  materialId: string;
  fileName: string;
  sizeBytes: number;
}

export type FileAnswerResult = Extract<FileAnswerResponse, { refused: false }>;

const PICK = "application/pdf,image/jpeg,image/png";
const BTN =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium shadow-xs transition-colors hover:border-foreground/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function AttachButton({ progress, disabled, onPick }: { progress: number | null; disabled: boolean; onPick: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = progress !== null;
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={PICK}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => ref.current?.click()}
        aria-label={busy ? `Uploading ${progress}%` : "Attach a PDF or photo for the AI to read"}
        title="Attach a PDF or photo (up to 10 MB, 30 pages) and ask about it"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:size-9"
      >
        {busy ? <span className="text-[10px] tabular-nums">{progress}%</span> : <Paperclip className="size-[18px]" aria-hidden />}
      </button>
    </>
  );
}

export type FileAction = "summary" | "mindmap" | "diagram";

/** Over the message box: the file in use, what to do with it, and the one-time agreement. */
export function FileBar({
  file, busy, needConsent, note, onAction, onAgree, onRemove, onDismissNote,
}: {
  file: AttachedFile | null;
  busy: boolean;
  needConsent: boolean;
  note: string | null;
  onAction: (a: FileAction) => void;
  onAgree: () => void;
  onRemove: () => void;
  onDismissNote: () => void;
}) {
  if (!file && !note) return null;
  return (
    <div className="mb-1.5 space-y-1.5">
      {note && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{note}</span>
          <button type="button" className="shrink-0 underline" onClick={onDismissNote}>
            Dismiss
          </button>
        </p>
      )}
      {file && (
        <div className="rounded-2xl border border-border bg-card/90 p-2 shadow-xs backdrop-blur">
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={file.fileName}>
              {file.fileName}
            </span>
            <button type="button" onClick={onRemove} aria-label={`Stop using ${file.fileName}`} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          {needConsent ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">To read it, the file is sent to the school&apos;s AI provider. Agree once and it will not ask again.</span>
              <button type="button" disabled={busy} onClick={onAgree} className={BTN}>
                Agree and read
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={busy} onClick={() => onAction("summary")} className={BTN}>
                <FileText className="size-3.5" aria-hidden /> Summarize
              </button>
              <button type="button" disabled={busy} onClick={() => onAction("mindmap")} className={BTN}>
                <Network className="size-3.5" aria-hidden /> Mind map
              </button>
              <button type="button" disabled={busy} onClick={() => onAction("diagram")} className={BTN}>
                <Workflow className="size-3.5" aria-hidden /> Flowchart
              </button>
              {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Reading the file" /> : <span className="text-xs text-muted-foreground">or type a question about it</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The answer in the conversation: the answer, what in the file backs it, and questions to ask next. */
export function FileAnswerCard({ result, onAsk, disabled }: { result: FileAnswerResult; onAsk: (q: string) => void; disabled: boolean }) {
  const { answer, points, found, followUps } = result.result;
  return (
    <section aria-label={`Answer from ${result.fileName}`} className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3.5" aria-hidden />
        <span className="truncate">{result.fileName}</span>
        {!found && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">Not covered in this file</span>}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
      {points.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-muted-foreground">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {followUps.map((q) => (
            <button key={q} type="button" disabled={disabled} onClick={() => onAsk(q)} className={BTN}>
              {q}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Read by AI from your file. It can miss things or get them wrong, so check the file for anything important. Nothing is saved.</p>
    </section>
  );
}
