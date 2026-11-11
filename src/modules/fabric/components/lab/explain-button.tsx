"use client";
// features-18 §D — "Explain with AI": posts { kind, ref } to /api/ai/lab-explain
// (the server re-reads the numbers) and shows the result labelled as AI-generated,
// or as a rule-based summary when the AI text failed the digit check.
// Nothing is saved. Callers pass a `key` that changes with `target` so a
// stale explanation never sits next to new numbers.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import type { LabExplainKind, LabExplainResponse } from "@/modules/fabric/lab.schemas";

export function ExplainButton({
  institutionSlug,
  kind,
  target = null,
  label = "Explain with AI",
}: {
  institutionSlug: string;
  kind: LabExplainKind;
  /** The request's `ref`: null for a whole panel, a section id, or scenario assumptions. */
  target?: unknown;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LabExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/lab-explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institutionSlug, kind, ref: target }),
      });
      const body = (await res.json()) as ActionResult<LabExplainResponse>;
      if (body.ok) setResult(body.data);
      else setError(body.error.message);
    } catch {
      setError("Could not reach the explanation service. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={explain} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {result ? "Explain again" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            {result.source === "ai"
              ? "AI-generated explanation — check it against the numbers before acting"
              : "Rule-based summary (the AI text was set aside because it used numbers not in the data)"}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {result.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground italic">{result.caveat}</p>
        </div>
      )}
    </div>
  );
}
