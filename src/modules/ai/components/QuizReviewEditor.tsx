"use client";

// T-036 — review + save (06 §W6 "Approvals": the review step IS the
// approval; there is no path from generation straight to a saved
// assignment). Shows `QuizGenerateButton` until a quiz exists, then an
// editable draft with the honesty header and `ProviderBadge`. "Save as
// draft" goes through the real `createAssignment` action (T-022) — full
// Zod validation and the teacher-scope check happen there, same as the
// manual assignment form; this component cannot write an assignment on
// its own.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createAssignment } from "@/modules/academics/assignments.actions";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { QuizGenerateButton, type QuizGenerateResult } from "@/modules/ai/components/QuizGenerateButton";
import type { QuizContent } from "@/modules/academics/assignments.schemas";

interface SectionOption {
  id: string;
  label: string;
}

interface QuestionDraft {
  stem: string;
  options: [string, string, string, string];
  answer: string;
  explanation: string;
}

function toDrafts(content: QuizContent): QuestionDraft[] {
  return content.questions.map((q) => ({
    stem: q.stem,
    options: q.options as [string, string, string, string],
    answer: q.answer,
    explanation: q.explanation ?? "",
  }));
}

interface QuizReviewEditorProps {
  institutionSlug: string;
  curriculumUnitId: string;
  subjectId: string;
  defaultTitle: string;
  sections: SectionOption[];
  aiPolicy: string;
  /**
   * D30/teacher-agent follow-up — when the quiz was already drafted
   * elsewhere (the chat agent's `generateQuiz` tool), skip the
   * `QuizGenerateButton` step and start straight in review mode. Saving
   * still goes through the same `createAssignment` call below: the agent
   * only fills the draft, this component's existing review-then-save
   * flow is the deterministic part, unchanged for either caller.
   */
  initialContent?: QuizContent;
}

export function QuizReviewEditor({
  institutionSlug,
  curriculumUnitId,
  subjectId,
  defaultTitle,
  sections,
  aiPolicy,
  initialContent,
}: QuizReviewEditorProps) {
  const router = useRouter();
  const [generated, setGenerated] = useState<QuizGenerateResult | null>(null);
  const [started, setStarted] = useState(Boolean(initialContent));
  const [questions, setQuestions] = useState<QuestionDraft[]>(initialContent ? toDrafts(initialContent) : []);
  const [title, setTitle] = useState(defaultTitle);
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleGenerated(result: QuizGenerateResult) {
    setGenerated(result);
    setStarted(true);
    setQuestions(toDrafts(result.content));
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function updateOption(index: number, optionIndex: number, value: string) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== index) return q;
        const options = [...q.options] as [string, string, string, string];
        const previous = options[optionIndex];
        options[optionIndex] = value;
        return { ...q, options, answer: q.answer === previous ? value : q.answer };
      }),
    );
  }

  function removeQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!sectionId || questions.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await createAssignment(institutionSlug, {
        classSectionId: sectionId,
        subjectId,
        curriculumUnitId,
        title,
        content: {
          questions: questions.map((q) => ({ ...q, explanation: q.explanation.trim() || undefined })),
        },
        aiGenerated: true,
      });
      if (!result.ok) {
        setSaveError(result.error.message);
        return;
      }
      router.push(`/${institutionSlug}/assignments/${result.data.id}`);
    } finally {
      setSaving(false);
    }
  }

  if (!started) {
    return (
      <QuizGenerateButton
        institutionSlug={institutionSlug}
        curriculumUnitId={curriculumUnitId}
        aiPolicy={aiPolicy}
        onGenerated={handleGenerated}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">AI draft — review before publishing</h2>
          {generated && <p className="text-muted-foreground text-xs">{generated.model}</p>}
        </div>
        {generated && <ProviderBadge provider={generated.provider} />}
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="title">
          Title
        </label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="sectionId">
          Section
        </label>
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger id="sectionId" className="w-full">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {questions.map((question, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Question {index + 1}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => removeQuestion(index)}>
                Remove
              </Button>
            </div>
            <Input value={question.stem} onChange={(e) => updateQuestion(index, { stem: e.target.value })} />
            {question.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${index}`}
                  aria-label={`Option ${optionIndex + 1} is correct`}
                  checked={option !== "" && option === question.answer}
                  onChange={() => updateQuestion(index, { answer: option })}
                />
                <Input value={option} onChange={(e) => updateOption(index, optionIndex, e.target.value)} />
              </div>
            ))}
            <Input
              placeholder="Explanation (optional)"
              value={question.explanation}
              onChange={(e) => updateQuestion(index, { explanation: e.target.value })}
            />
          </div>
        ))}
      </div>

      {saveError && (
        <p role="alert" className="text-destructive text-sm">
          {saveError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={saving || !sectionId || questions.length === 0}>
        {saving ? "Saving…" : "Save as draft"}
      </Button>
    </div>
  );
}
