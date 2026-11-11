"use client";
// features-18 §D — "Describe a scenario": text -> /api/ai/lab-scenario ->
// slider values the server already clamped to the slider ranges. Shown as
// a proposal (current -> suggested); nothing moves until the person applies it.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import { PARAM_LABELS } from "./results-panel";

export function ScenarioAi({
  institutionSlug,
  current,
  onApply,
}: {
  institutionSlug: string;
  current: ScenarioAssumptions;
  onApply: (next: ScenarioAssumptions) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Partial<ScenarioAssumptions> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function suggest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/ai/lab-scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institutionSlug, text }),
      });
      const body = (await res.json()) as ActionResult<{ assumptions: Partial<ScenarioAssumptions> }>;
      if (body.ok) setProposal(body.data.assumptions);
      else setError(body.error.message);
    } catch {
      setError("Could not reach the AI service. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const changes = proposal
    ? (Object.entries(proposal) as [keyof ScenarioAssumptions, number][]).filter(([key, value]) => current[key] !== value)
    : [];

  return (
    <form onSubmit={suggest} className="space-y-2 rounded-lg border p-3">
      <label htmlFor="sim-describe" className="text-sm font-medium">
        Describe a scenario
      </label>
      <Textarea
        id="sim-describe"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="e.g. 10% more students next year, hire 3 teachers, fees up 6%"
      />
      <Button type="submit" variant="outline" size="sm" disabled={busy || text.trim().length < 3}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        Suggest assumptions
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {proposal && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2 text-sm" aria-live="polite">
          <p className="text-xs font-medium text-muted-foreground">AI suggestion — review before applying</p>
          {changes.length === 0 ? (
            <p>The description did not change any slider.</p>
          ) : (
            <ul className="space-y-0.5">
              {changes.map(([key, value]) => (
                <li key={key} className="tabular-nums">
                  {PARAM_LABELS[key] ?? key}: {current[key]} → <span className="font-medium">{value}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {changes.length > 0 && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply({ ...current, ...proposal });
                  setProposal(null);
                }}
              >
                Apply to sliders
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setProposal(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
