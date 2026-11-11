"use client";

// features-18 §C2 — "Handover note" per substitution: POST /api/ai/substitution-note.
// With no lesson plan or diary entry on record the server returns fixed text
// (no AI, no AI label). The note is editable and copied by hand; nothing is saved.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";

interface Note {
  note: string;
  provider: "local" | "cloud" | null;
}

export function HandoverNoteButton({ institutionSlug, substitutionId }: { institutionSlug: string; substitutionId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<Note>("/api/ai/substitution-note", { institutionSlug, substitutionId });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setNote(res.data);
    setValue(res.data.note);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Note copied");
    } catch {
      toast.error("Could not copy; select the text and copy it.");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={load}>
        {busy ? "Writing…" : "Handover note"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {note && (
        <div className="max-w-md space-y-2 rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{note.provider ? "AI draft — review before sharing" : "No plan on record"}</span>
            {note.provider && <ProviderBadge provider={note.provider} />}
          </div>
          <Textarea aria-label="Handover note" rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="button" size="sm" onClick={copy} disabled={!value.trim()}>
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}
