"use client";

// Hiding these is UX only: actions re-check resource.manage / document.write, Zod and RLS.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createClient } from "@/lib/supabase/client";
import { confirmUpload, getReadUrl, requestUpload } from "@/modules/documents/actions";
import { checkUploadFile } from "@/modules/documents/upload-check";
import { attachResourceFile, createResource, deleteResource, publishResource } from "@/modules/resources/actions";
import { RESOURCE_KINDS, ResourceCreateSchema } from "@/modules/resources/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const BUCKET = "tenant-docs";
const KIND_LABEL = { link: "Link", video: "Video link", note: "Note", file: "File (PDF or image)" } as const;

/** Documents-module signed upload for a `resource` entity, then attach to the resource. Returns an error message or null. */
async function uploadAndAttach(slug: string, resourceId: string, file: File): Promise<string | null> {
  const bad = checkUploadFile(file);
  if (bad) return bad;
  const req = await requestUpload(slug, { entityType: "resource", entityId: resourceId, kind: "resource file", fileName: file.name, mime: file.type as "application/pdf", sizeBytes: file.size });
  if (!req.ok) return describeActionError(req.error);
  const up = await createClient().storage.from(BUCKET).uploadToSignedUrl(req.data.path, req.data.token, file, { contentType: file.type });
  if (up.error) return "The file could not be uploaded. Try again.";
  const done = await confirmUpload(slug, { documentId: req.data.documentId });
  if (!done.ok) return describeActionError(done.error);
  const attached = await attachResourceFile(slug, { resourceId, documentId: req.data.documentId });
  return attached.ok ? null : describeActionError(attached.error);
}

export interface Option {
  id: string;
  label: string;
}

export function CreateResourceForm({
  institutionSlug,
  subjects,
  units,
  sections,
}: {
  institutionSlug: string;
  subjects: Option[];
  units: { id: string; subjectId: string; label: string }[];
  sections: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof RESOURCE_KINDS)[number]>("link");
  const [subjectId, setSubjectId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = ResourceCreateSchema.safeParse({
      title: fd.get("title"),
      kind,
      url: String(fd.get("url") ?? "") || undefined,
      subjectId: fd.get("subjectId"),
      curriculumUnitId: String(fd.get("curriculumUnitId") ?? "") || undefined,
      description: String(fd.get("description") ?? "") || undefined,
      classSectionIds: fd.getAll("classSectionIds").map(String),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    const file = fileRef.current?.files?.[0];
    setError(null);
    start(async () => {
      const res = await createResource(institutionSlug, parsed.data);
      if (!res.ok) return setError(describeActionError(res.error));
      if (kind === "file" && file) {
        const problem = await uploadAndAttach(institutionSlug, res.data.id, file);
        if (problem) {
          toast.error(`Saved as a draft, but the file was not attached: ${problem}`);
          return void router.refresh();
        }
      }
      toast.success("Resource saved as a draft");
      form.reset();
      setKind("link");
      setSubjectId("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div className="sm:col-span-2">
        <Label htmlFor="rs-title">Title</Label>
        <Input id="rs-title" name="title" required maxLength={160} />
      </div>
      <div>
        <Label htmlFor="rs-kind">Type</Label>
        <select id="rs-kind" className={SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {RESOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="rs-subject">Subject</Label>
        <select id="rs-subject" name="subjectId" required className={SELECT_CLASS} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="" disabled>
            Select a subject
          </option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="rs-unit">Curriculum unit (optional)</Label>
        <select id="rs-unit" name="curriculumUnitId" className={SELECT_CLASS} defaultValue="" key={subjectId}>
          <option value="">None</option>
          {units
            .filter((u) => u.subjectId === subjectId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
        </select>
      </div>
      {(kind === "link" || kind === "video") && (
        <div>
          <Label htmlFor="rs-url">Link (https only)</Label>
          <Input id="rs-url" name="url" type="url" required maxLength={2000} placeholder="https://" />
        </div>
      )}
      {kind === "file" && (
        <div>
          <Label htmlFor="rs-file">File (PDF, JPEG or PNG, up to 10 MB)</Label>
          <Input id="rs-file" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" />
        </div>
      )}
      <div className="sm:col-span-2">
        <Label htmlFor="rs-description">{kind === "note" ? "Note text" : "Description (optional)"}</Label>
        <Input id="rs-description" name="description" maxLength={2000} required={kind === "note"} />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium">Share with sections</legend>
        {sections.length === 0 ? (
          <p className="text-muted-foreground text-sm">You teach no sections yet.</p>
        ) : (
          <div className="mt-1 space-y-1">
            {byGrade(sections).map(([grade, list]) => (
              <div key={grade} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{grade}</span>
                {list.map((s) => (
                  <label key={s.id} className="flex min-h-8 items-center gap-1.5 text-sm">
                    <input type="checkbox" name="classSectionIds" value={s.id} />
                    {s.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}

export function ResourceRowActions({
  institutionSlug,
  resourceId,
  kind,
  published,
  hasFile,
}: {
  institutionSlug: string;
  resourceId: string;
  kind: string;
  published: boolean;
  hasFile: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<string | null>, done: string) =>
    start(async () => {
      const problem = await fn();
      if (problem) return void toast.error(problem);
      toast.success(done);
      router.refresh();
    });

  const togglePublish = () =>
    run(async () => {
      const res = await publishResource(institutionSlug, { resourceId, published: !published });
      return res.ok ? null : describeActionError(res.error);
    }, published ? "Unpublished" : "Published");

  const remove = () => {
    if (!window.confirm("Delete this resource?")) return;
    run(async () => {
      const res = await deleteResource(institutionSlug, { resourceId });
      return res.ok ? null : describeActionError(res.error);
    }, "Resource deleted");
  };

  const attach = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return void toast.error("Choose a file first.");
    run(() => uploadAndAttach(institutionSlug, resourceId, file), "File attached");
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {kind === "file" && !hasFile && (
        <>
          <Input ref={fileRef} aria-label="File to attach" type="file" accept="application/pdf,image/jpeg,image/png" className="h-8 w-44" />
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={attach}>
            Attach file
          </Button>
        </>
      )}
      <Button type="button" size="sm" disabled={pending || (kind === "file" && !hasFile && !published)} onClick={togglePublish}>
        {published ? "Unpublish" : "Publish"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={remove}>
        Delete
      </Button>
    </div>
  );
}

/** Signed URL is minted on click (60 s expiry, audited) through the documents module; never stored in the page. */
export function DownloadFileButton({ institutionSlug, documentId, fileName }: { institutionSlug: string; documentId: string; fileName: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Download ${fileName}`}
      onClick={() =>
        start(async () => {
          const res = await getReadUrl(institutionSlug, { documentId });
          if (!res.ok) return void toast.error(describeActionError(res.error));
          window.open(res.data.url, "_blank", "noopener,noreferrer");
        })
      }
    >
      Download
    </Button>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Rows of sections per grade ("VI-A" -> "VI"), grades in class order, so 70+ sections read as a grid. */
function byGrade(sections: readonly Option[]): [string, Option[]][] {
  const groups = new Map<string, Option[]>();
  for (const s of sections) {
    const grade = s.label.split("-")[0]!.trim();
    groups.set(grade, [...(groups.get(grade) ?? []), s]);
  }
  const rank = (g: string) => (ROMAN.includes(g) ? ROMAN.indexOf(g) : ROMAN.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([g, list]) => [g, [...list].sort((x, y) => x.label.localeCompare(y.label))]);
}
