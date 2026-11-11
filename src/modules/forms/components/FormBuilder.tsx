"use client";

// Form builder: add / reorder / remove fields, pick audience sections, save a draft. Hiding controls is UX
// only; the actions re-check form.manage, the same Zod schema and the DB trigger. Labels are rendered as text.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { closeForm, createForm, publishForm, updateForm } from "@/modules/forms/actions";
import { FORM_MAX_FIELDS, FormCreateSchema, type FormField } from "@/modules/forms/schemas";
import { FormDraftWithAi } from "@/modules/ai/components/FormDraftWithAi";
import { TranslateButton } from "@/modules/ai/components/TranslateButton";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

interface DraftField {
  type: FormField["type"];
  label: string;
  required: boolean;
  /** One option per line (choice only). */
  options: string;
}

const blank = (): DraftField => ({ type: "text", label: "", required: false, options: "" });

function toDraft(f: FormField): DraftField {
  return { type: f.type, label: f.label, required: f.required ?? false, options: f.type === "choice" ? f.options.join("\n") : "" };
}

function toField(d: DraftField) {
  const base = { label: d.label, required: d.required };
  return d.type === "choice"
    ? { type: "choice" as const, ...base, options: d.options.split("\n").map((o) => o.trim()).filter(Boolean) }
    : { type: d.type, ...base };
}

export interface BuilderForm {
  id: string;
  title: string;
  description: string | null;
  fields: FormField[];
  classSectionIds: string[];
}

export function FormBuilder({
  institutionSlug,
  sections,
  initial,
  ai,
}: {
  institutionSlug: string;
  sections: { id: string; label: string }[];
  initial?: BuilderForm;
  /** Shows AI controls only; the AI routes re-check permission and capability. */
  ai?: { draft: boolean; translate: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [fields, setFields] = useState<DraftField[]>(initial ? initial.fields.map(toDraft) : [blank()]);
  const [picked, setPicked] = useState<string[]>(initial?.classSectionIds ?? []);

  const setF = (i: number, patch: Partial<DraftField>) => setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = { title, description: description || undefined, fields: fields.map(toField), classSectionIds: picked };
    const parsed = FormCreateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setErrors([]);
    start(async () => {
      const res = initial ? await updateForm(institutionSlug, { formId: initial.id, ...parsed.data }) : await createForm(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success(initial ? "Draft saved" : "Draft created");
        if (!initial) {
          setTitle("");
          setDescription("");
          setFields([blank()]);
          setPicked([]);
        }
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(Object.entries(res.error.fieldErrors).map(([k, v]) => `${k}: ${v.join(" ")}`));
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      {ai?.draft && !initial && (
        <FormDraftWithAi
          institutionSlug={institutionSlug}
          onDraft={(d) => {
            setTitle(d.title);
            setDescription(d.description ?? "");
            setFields(d.fields.map(toDraft));
            setErrors([]);
          }}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`fm-title-${initial?.id ?? "new"}`}>Title</Label>
          <Input id={`fm-title-${initial?.id ?? "new"}`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`fm-desc-${initial?.id ?? "new"}`}>Description (optional)</Label>
          <Input id={`fm-desc-${initial?.id ?? "new"}`} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
          {ai?.translate && (
            <div className="mt-2">
              <TranslateButton institutionSlug={institutionSlug} text={description} onUse={setDescription} />
            </div>
          )}
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Fields</legend>
        {fields.map((f, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <select aria-label={`Field ${i + 1} type`} className={SELECT_CLASS} value={f.type} onChange={(e) => setF(i, { type: e.target.value as DraftField["type"] })}>
                <option value="text">Short text</option>
                <option value="choice">Choice</option>
                <option value="consent">Consent checkbox</option>
              </select>
              <Input
                aria-label={`Field ${i + 1} ${f.type === "consent" ? "consent text" : "label"}`}
                className="min-w-48 flex-1"
                placeholder={f.type === "consent" ? "Consent text the respondent agrees to" : "Question"}
                maxLength={200}
                value={f.label}
                onChange={(e) => setF(i, { label: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.required} onChange={(e) => setF(i, { required: e.target.checked })} />
                Required
              </label>
            </div>
            {f.type === "choice" && (
              <textarea
                aria-label={`Field ${i + 1} options, one per line`}
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Options, one per line (2 to 10)"
                value={f.options}
                onChange={(e) => setF(i, { options: e.target.value })}
              />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move field ${i + 1} up`}>
                Up
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={`Move field ${i + 1} down`}>
                Down
              </Button>
              {fields.length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setFields((fs) => fs.filter((_, idx) => idx !== i))}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
        {fields.length < FORM_MAX_FIELDS && (
          <Button type="button" variant="outline" size="sm" onClick={() => setFields((fs) => [...fs, blank()])}>
            Add field
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Audience sections</legend>
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <label key={s.id} className="flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))}
              />
              {s.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Guardians and students of these sections, and the teachers of them, see the form once it is published.</p>
      </fieldset>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : initial ? "Save draft" : "Create draft"}
      </Button>
    </form>
  );
}

/** Publish (draft) or close (published). Both are human steps and cannot be undone. */
export function FormStatusButton({ institutionSlug, formId, title, mode }: { institutionSlug: string; formId: string; title: string; mode: "publish" | "close" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const publish = mode === "publish";
  return (
    <>
      <Button type="button" size="sm" variant={publish ? "default" : "outline"} onClick={() => setOpen(true)}>
        {publish ? "Publish" : "Close"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{publish ? "Publish this form?" : "Close this form?"}</DialogTitle>
            <DialogDescription>
              {publish
                ? `"${title}" goes to its audience and can no longer be edited.`
                : `"${title}" stops accepting responses. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await (publish ? publishForm : closeForm)(institutionSlug, { formId });
                  if (res.ok) {
                    toast.success(publish ? "Form published" : "Form closed");
                    setOpen(false);
                    router.refresh();
                  } else {
                    toast.error(describeActionError(res.error));
                  }
                })
              }
            >
              {pending ? "Working…" : publish ? "Publish" : "Close form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
