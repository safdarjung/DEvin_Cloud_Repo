"use client";

// features-18 §C #15 — "Draft with AI" inside the lesson-plan dialog. Calls
// /api/ai/lesson-plan (persists nothing) and hands the text to the form;
// the teacher edits it and saves with the form's own upsertLessonPlan.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiDraftBadge } from "@/modules/ai/components/AiDraft";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import { LESSON_PLAN_MAX_PERIODS, lessonPlanDraftToForm, type LessonPlanDraftResponse } from "@/modules/ai/lesson-plan.schemas";

interface Props {
  institutionSlug: string;
  classSectionId: string;
  subjectId: string;
  curriculumUnitId: string;
  onDraft: (form: { title: string; objectives: string; resources: string }) => void;
}

export function LessonPlanAiDraft({ institutionSlug, classSectionId, subjectId, curriculumUnitId, onDraft }: Props) {
  const [periods, setPeriods] = useState(1);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"local" | "cloud" | null>(null);

  async function draft() {
    setBusy(true);
    setError(null);
    const result = await postAiTask<LessonPlanDraftResponse>("/api/ai/lesson-plan", {
      institutionSlug,
      classSectionId,
      subjectId,
      curriculumUnitId,
      periods,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setProvider(result.data.provider);
    onDraft({ title: result.data.unitTitle.slice(0, 120), ...lessonPlanDraftToForm(result.data.draft) });
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          Periods
          <Input
            type="number"
            min={1}
            max={LESSON_PLAN_MAX_PERIODS}
            value={periods}
            onChange={(e) => setPeriods(Math.min(LESSON_PLAN_MAX_PERIODS, Math.max(1, Number(e.target.value) || 1)))}
            className="w-20"
          />
        </label>
        <label className="min-w-0 flex-1 space-y-1">
          Notes for AI (optional)
          <Input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. use the number line" />
        </label>
        <Button type="button" variant="outline" disabled={busy} onClick={draft}>
          {busy ? "Drafting…" : "Draft with AI"}
        </Button>
      </div>
      {provider && <AiDraftBadge provider={provider} text="AI draft — review before saving" />}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
