"use client";

// Document controls. Hiding them is UX only: every action re-checks document.read / document.write.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createClient } from "@/lib/supabase/client";
import { confirmUpload, deleteDocument, getReadUrl, requestUpload } from "@/modules/documents/actions";
import { checkUploadFile } from "@/modules/documents/upload-check";

const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";
const BUCKET = "tenant-docs";

export function UploadForm({ institutionSlug, entityType, owners }: { institutionSlug: string; entityType: "student" | "staff"; owners: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [ownerId, setOwnerId] = useState("");
  const [kind, setKind] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    setError(null);
    setFieldErrors({});
    if (!file || !ownerId) return setError("Choose who the document belongs to and a file.");
    const bad = checkUploadFile(file);
    if (bad) return setError(bad);
    start(async () => {
      const req = await requestUpload(institutionSlug, { entityType, entityId: ownerId, kind, fileName: file.name, mime: file.type as "application/pdf", sizeBytes: file.size });
      if (!req.ok) {
        setFieldErrors(req.error.fieldErrors ?? {});
        return setError(describeActionError(req.error));
      }
      const up = await createClient().storage.from(BUCKET).uploadToSignedUrl(req.data.path, req.data.token, file, { contentType: file.type });
      if (up.error) return setError("The file could not be uploaded. Try again.");
      const done = await confirmUpload(institutionSlug, { documentId: req.data.documentId });
      if (!done.ok) return setError(describeActionError(done.error));
      toast.success("Document uploaded");
      setKind("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const fe = (k: string) => fieldErrors[k]?.length && <p role="alert" className="mt-1 text-xs text-destructive">{fieldErrors[k]!.join(" ")}</p>;
  return (
    <form className="grid gap-3 sm:grid-cols-2" aria-busy={pending} onSubmit={submit}>
      <div>
        <Label htmlFor="doc-owner">{entityType === "student" ? "Student" : "Staff member"}</Label>
        <select id="doc-owner" className={SELECT_CLASS} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={pending}>
          <option value="">Choose…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {fe("entityId")}
      </div>
      <div>
        <Label htmlFor="doc-kind">Kind (e.g. birth certificate)</Label>
        <Input id="doc-kind" value={kind} maxLength={60} onChange={(e) => setKind(e.target.value)} aria-invalid={Boolean(fieldErrors.kind)} />
        {fe("kind")}
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="doc-file">File (PDF, JPEG or PNG, up to 10 MB)</Label>
        <Input id="doc-file" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" disabled={pending} />
        {fe("fileName")}
        {fe("sizeBytes")}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}

export function DocumentRowActions({ institutionSlug, documentId, fileName, canRead, canWrite }: { institutionSlug: string; documentId: string; fileName: string; canRead: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Signed URL is minted on click (60 s expiry, audited), never stored in the page.
  function download() {
    start(async () => {
      const res = await getReadUrl(institutionSlug, { documentId });
      if (!res.ok) return void toast.error(describeActionError(res.error));
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    });
  }
  function remove() {
    if (!window.confirm(`Delete "${fileName}"?`)) return;
    start(async () => {
      const res = await deleteDocument(institutionSlug, { documentId });
      if (!res.ok) return void toast.error(describeActionError(res.error));
      toast.success("Document deleted");
      router.refresh();
    });
  }
  return (
    <div className="flex justify-end gap-2">
      {canRead && (
        <Button type="button" size="sm" variant="outline" onClick={download} disabled={pending} aria-label={`Download ${fileName}`}>
          Download
        </Button>
      )}
      {canWrite && (
        <Button type="button" size="sm" variant="outline" onClick={remove} disabled={pending} aria-label={`Delete ${fileName}`}>
          Delete
        </Button>
      )}
    </div>
  );
}
