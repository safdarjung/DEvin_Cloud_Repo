"use client";

// features-18 §C2 — "Summarise" on a lab's safety check: POST /api/ai/lab-safety-note.
// AI wording is shown only when it keeps every listed item; otherwise the plain
// deterministic list comes back (no AI label). Read-only; nothing is saved.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";

interface Note {
  note: string;
  source: "ai" | "rules";
  provider: "local" | "cloud" | null;
}

export function LabSafetyNoteButton({ institutionSlug, labId }: { institutionSlug: string; labId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<Note>("/api/ai/lab-safety-note", { institutionSlug, labId });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setNote(res.data);
  }

  return (
    <div className="mt-2 space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={load}>
        {busy ? "Summarising…" : "Summarise"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {note && (
        <div role="status" className="space-y-1 rounded-md border bg-card p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{note.source === "ai" ? "AI wording of the list above — the list is the record" : "Plain list (AI wording unavailable or changed an item)"}</span>
            {note.source === "ai" && note.provider && <ProviderBadge provider={note.provider} />}
          </div>
          <p>{note.note}</p>
        </div>
      )}
    </div>
  );
}
