"use client";

// features-18 §C2 — "Draft with AI" for the forms builder: POST /api/ai/form-draft
// with a short description; the validated draft fills the builder through
// `onDraft`. The manager edits it and saves with `form.create`; publishing
// stays a separate human step.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";
import type { FormDraft } from "@/modules/ai/task-drafts";

export function FormDraftWithAi({ institutionSlug, onDraft }: { institutionSlug: string; onDraft: (draft: FormDraft) => void }) {
  const id = useId();
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<AiProviderMeta["provider"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<FormDraft & AiProviderMeta>("/api/ai/form-draft", { institutionSlug, description });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    const { title, description: formDescription, fields } = res.data;
    onDraft({ title, description: formDescription, fields });
    setProvider(res.data.provider);
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <label htmlFor={id} className="text-sm font-medium">
        Draft with AI
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="min-w-64 flex-1"
          maxLength={500}
          placeholder="e.g. Consent slip for Friday's zoo trip, with a lunch choice"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="button" variant="outline" disabled={busy || !description.trim()} onClick={draft}>
          {busy ? "Drafting…" : "Draft with AI"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {provider && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          AI draft loaded below — review every field before saving. <ProviderBadge provider={provider} />
        </p>
      )}
    </div>
  );
}
