"use client";

// Curriculum files list + upload (0139). Hiding controls is UX only: every
// action re-checks permission and RLS decides each row, document and object.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { formatBytes } from "@/modules/documents/upload-check";
import { deleteMaterial, getMaterialReadUrl, reviewMaterial, suggestMaterial } from "@/modules/textbooks/materials.actions";
import { uploadMaterialFile, type UploadTarget } from "./upload-file";

export interface PanelItem {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  visibility: "private" | "class";
  suggestion: "none" | "suggested" | "approved" | "declined";
  canDelete: boolean;
  /** Student's own filed private file: suggest / withdraw. */
  canSuggest?: boolean;
  /** Subject teacher or leader on a suggested file. */
  canReview?: boolean;
}

interface Props {
  institutionSlug: string;
  heading: string;
  description?: string;
  items: PanelItem[];
  emptyText: string;
  /** Present when the viewer may upload here. */
  upload?: { target?: UploadTarget; private?: boolean; label: string };
  idPrefix: string;
}

const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

function StatusBadge({ item }: { item: PanelItem }) {
  if (item.suggestion === "suggested") return <Badge variant="info">Suggested to teacher</Badge>;
  if (item.suggestion === "declined") return <Badge variant="outline">Not added to class</Badge>;
  if (item.suggestion === "approved") return <Badge variant="success">Added to class</Badge>;
  return item.visibility === "private" ? <Badge variant="outline">Private</Badge> : null;
}

export function MaterialsPanel({ institutionSlug, heading, description, items, emptyText, upload, idPrefix }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = `${idPrefix}-file`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    setError(null);
    if (!file || !upload) return setError("Choose a file first.");
    start(async () => {
      const res = await uploadMaterialFile(institutionSlug, file, { target: upload.target, private: upload.private }, setProgress);
      setProgress(null);
      if (!res.ok) return setError(res.error);
      toast.success("File uploaded");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function run(task: () => Promise<ActionResult<unknown>>, done: string) {
    start(async () => {
      const res = await task();
      if (!res.ok) return void toast.error(describeActionError(res.error));
      toast.success(done);
      router.refresh();
    });
  }

  function download(item: PanelItem) {
    start(async () => {
      const res = await getMaterialReadUrl(institutionSlug, { materialId: item.id });
      if (!res.ok) return void toast.error(describeActionError(res.error));
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="space-y-2">
      <div>
        <h3 id={`${idPrefix}-heading`} className="text-sm font-semibold">
          {heading}
        </h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex items-center gap-1.5 font-medium">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{item.title}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.fileName} · {formatBytes(item.sizeBytes)} · {date.format(new Date(item.createdAt))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge item={item} />
                <Button type="button" size="sm" variant="outline" onClick={() => download(item)} disabled={pending} aria-label={`Download ${item.title}`}>
                  <Download className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Download</span>
                </Button>
                {item.canSuggest && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => suggestMaterial(institutionSlug, { materialId: item.id, suggest: item.suggestion !== "suggested" }),
                        item.suggestion === "suggested" ? "Suggestion withdrawn" : "Suggested to your teacher",
                      )
                    }
                  >
                    {item.suggestion === "suggested" ? "Withdraw" : "Suggest to teacher"}
                  </Button>
                )}
                {item.canReview && (
                  <>
                    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => reviewMaterial(institutionSlug, { materialId: item.id, decision: "approve" }), "Added to class materials")}>
                      Approve
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewMaterial(institutionSlug, { materialId: item.id, decision: "decline" }), "Suggestion declined")}>
                      Decline
                    </Button>
                  </>
                )}
                {item.canDelete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    aria-label={`Delete ${item.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${item.title}"? This cannot be undone.`)) run(() => deleteMaterial(institutionSlug, { materialId: item.id }), "File deleted");
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Delete</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {upload && (
        <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={submit} aria-busy={pending}>
          <div className="min-w-0 flex-1">
            <Label htmlFor={inputId} className="text-xs">
              {upload.label} (PDF, JPEG or PNG, up to 10 MB)
            </Label>
            <Input id={inputId} ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" disabled={pending} />
          </div>
          <Button type="submit" size="sm" disabled={pending} className="min-h-9">
            <Upload className="size-4" aria-hidden /> {pending && progress !== null ? `Uploading ${progress}%` : pending ? "Working…" : "Upload"}
          </Button>
          {progress !== null && (
            <progress className="h-1.5 w-full" max={100} value={progress} aria-label="Upload progress">
              {progress}%
            </progress>
          )}
          {error && (
            <p role="alert" className="w-full text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
