"use client";

// Chat attach control (0139): uploads through the same path as the "My files"
// UI as an unfiled private file, then sends the assistant only the file's
// name, size and id plus the person's own subjects/units, so it can propose
// a place. Nothing is attached until the person confirms the draft card.
import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/modules/documents/upload-check";
import { uploadMaterialFile, type UploadOutcome } from "./upload-file";

type Targets = Extract<UploadOutcome, { ok: true }>["targets"];
// The chat accepts text parts up to 4000 characters (ui-message-schema); stay under it.
const MAX_CHARS = 3800;

/** What the assistant gets: the file's name, size and id, and the person's own subjects/units grouped by grade. Never the content. */
export function attachMessage(file: { fileName: string; sizeBytes: number; materialId: string }, targets: Targets): string {
  const head = `I uploaded the file "${file.fileName.slice(0, 120)}" (${formatBytes(file.sizeBytes)}), file id ${file.materialId}. Propose where to attach it.`;
  if (targets.length === 0) return `${head}\nI have no subjects to file it under.`;
  const lines = [head, "My subjects and units:"];
  let lastGrade = "";
  for (const t of targets) {
    const next: string[] = [];
    if (t.gradeId !== lastGrade) next.push(`${t.gradeName} (grade ${t.gradeId}):`);
    const units = t.units.map((u) => `${u.title} (unit ${u.id})`).join("; ");
    next.push(`- ${t.subjectName} (subject ${t.subjectId})${units ? `: ${units}` : ""}`);
    if ([...lines, ...next].join("\n").length > MAX_CHARS - 40) {
      lines.push("(list cut short)");
      break;
    }
    lines.push(...next);
    lastGrade = t.gradeId;
  }
  return lines.join("\n");
}

export function ChatFileAttach({ institutionSlug, disabled, onReady }: { institutionSlug: string; disabled?: boolean; onReady: (text: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setProgress(0);
    const res = await uploadMaterialFile(institutionSlug, file, {}, setProgress);
    setProgress(null);
    if (!res.ok) return setError(res.error);
    onReady(attachMessage(res, res.targets));
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
        aria-label={busy ? `Uploading ${progress}%` : "Attach a PDF or photo (the assistant sees only its name and size)"}
        title="Attach a PDF or photo. The assistant sees only its name and size, never its content."
        className="shrink-0"
      >
        {busy ? <span className="text-[10px] tabular-nums">{progress}%</span> : <Paperclip className="size-4" aria-hidden />}
      </Button>
      {error && <AttachError message={error} onClose={() => setError(null)} />}
    </>
  );
}

function AttachError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div role="alert" className="absolute -top-9 left-1 right-1 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-background px-2 py-1 text-xs text-destructive shadow-sm">
      <span className="min-w-0 truncate">{message}</span>
      <button type="button" className="shrink-0 underline" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}
