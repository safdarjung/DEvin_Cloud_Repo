"use client";

// features-18 §H step 3 — "Suggest with AI" for headers the exact/alias matcher
// left unmatched: POST /api/ai/import-mapping with header strings only (never
// rows). Suggestions are listed for the owner, applied only on "Use these", and
// still go through the normal column selects and "Check the file".
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAiMappingSlot } from "@/modules/core/setup/components/StepPeople";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import { IMPORT_MAPPING_MAX_HEADERS } from "@/modules/ai/import-mapping";

interface Suggestion {
  header: string;
  column: string | null;
  source: "rules" | "ai" | null;
}

export function ImportMappingSuggest({ institutionSlug }: { institutionSlug: string }) {
  const slot = useAiMappingSlot();
  const [picks, setPicks] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!slot) return null;
  const { entity, unmatchedHeaders, apply } = slot;
  // Headers only, trimmed to the route's limits (<= 40 headers, <= 80 chars each).
  const headers = [...new Set(unmatchedHeaders.map((h) => h.trim().slice(0, 80)).filter(Boolean))].slice(0, IMPORT_MAPPING_MAX_HEADERS);
  if (headers.length === 0 && !picks) return null;

  async function suggest() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<{ suggestions: Suggestion[] }>("/api/ai/import-mapping", { institutionSlug, entityType: entity, headers });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setPicks(res.data.suggestions.filter((s) => s.column !== null));
  }

  function use() {
    apply(Object.fromEntries((picks ?? []).map((p) => [p.header, p.column as string])));
    setPicks(null);
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <Button type="button" size="sm" variant="outline" disabled={busy || headers.length === 0} onClick={suggest}>
        {busy ? "Suggesting…" : "Suggest with AI"}
      </Button>
      <p className="text-xs text-muted-foreground">Sends only the unmatched header names, never your rows. You confirm before anything changes.</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {picks && (
        <div role="status" className="space-y-2">
          {picks.length === 0 ? (
            <p>No confident match. Pick the columns yourself below.</p>
          ) : (
            <>
              <p className="font-medium">Suggested matches — check each one:</p>
              <ul className="space-y-1">
                {picks.map((p) => (
                  <li key={p.header}>
                    <span className="font-medium">{p.header}</span> → {p.column}
                    {p.source === "ai" && <span className="ml-1 text-xs text-muted-foreground">(AI)</span>}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={use}>
                  Use these
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicks(null)}>
                  Dismiss
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
