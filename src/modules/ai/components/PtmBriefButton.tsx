"use client";

// features-18 §C #18 — "Brief" on a booked PTM slot. Calls /api/ai/ptm-brief
// and shows the suggestions; nothing is stored against the student.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiDraftBadge } from "@/modules/ai/components/AiDraft";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import type { PtmBriefResponse } from "@/modules/ai/ptm-brief.schemas";

const SECTIONS = [
  { key: "strengths", label: "Strengths" },
  { key: "concerns", label: "Concerns" },
  { key: "talkingPoints", label: "Talking points" },
  { key: "nextSteps", label: "Suggested next steps" },
] as const;

export function PtmBriefButton({ institutionSlug, studentId, studentName }: { institutionSlug: string; studentId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PtmBriefResponse | null>(null);

  async function prepare() {
    setOpen(true);
    if (result) return;
    setBusy(true);
    setError(null);
    const response = await postAiTask<PtmBriefResponse>("/api/ai/ptm-brief", { institutionSlug, studentId });
    setBusy(false);
    if (response.ok) setResult(response.data);
    else setError(response.message);
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={prepare} aria-label={`Meeting brief for ${studentName}`}>
        Brief
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Meeting brief: {studentName}</DialogTitle>
            <DialogDescription>AI-generated suggestions from attendance, marks and homework. Check them before the meeting.</DialogDescription>
          </DialogHeader>
          {busy && <p className="text-sm text-muted-foreground">Preparing…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {result && (
            <div className="space-y-3 text-sm">
              <AiDraftBadge provider={result.provider} text="AI-generated — suggestions only" />
              {SECTIONS.map(({ key, label }) =>
                result.brief[key].length === 0 ? null : (
                  <section key={key} className="space-y-1">
                    <h3 className="font-medium">{label}</h3>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {result.brief[key].map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
