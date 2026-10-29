"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { createAssignment, updateAssignment } from "@/modules/academics/assignments.actions";
import type { AssignmentDetail, SectionOption, SubjectOption } from "@/modules/academics/assignments.queries";

interface SectionWithSubjects extends SectionOption {
  subjects: SubjectOption[];
}

interface QuestionDraft {
  stem: string;
  options: [string, string, string, string];
  answer: string;
  explanation: string;
}

interface AssignmentFormProps {
  institutionSlug: string;
  /** Sections (and the subjects taught there) the signed-in teacher/owner/principal may pick from. Empty when editing. */
  sections: SectionWithSubjects[];
  /** Present only when editing an existing draft — section/subject are then immutable (out of scope for T-022). */
  assignment?: AssignmentDetail;
}

function emptyQuestion(): QuestionDraft {
  return { stem: "", options: ["", "", "", ""], answer: "", explanation: "" };
}

// shortcut: curriculum unit selection isn't wired into this form yet
// (CreateAssignmentSchema/the action already validate curriculumUnitId when
// given — there's just no picker here). Upgrade once a page needs it.
export function AssignmentForm({ institutionSlug, sections, assignment }: AssignmentFormProps) {
  const router = useRouter();
  const isEditing = Boolean(assignment);

  const [sectionId, setSectionId] = useState(assignment?.classSectionId ?? sections[0]?.id ?? "");
  const section = sections.find((s) => s.id === sectionId);
  const [subjectId, setSubjectId] = useState(assignment?.subjectId ?? section?.subjects[0]?.id ?? "");

  const [questions, setQuestions] = useState<QuestionDraft[]>(
    assignment?.content?.questions.map((q) => ({
      stem: q.stem,
      options: q.options as [string, string, string, string],
      answer: q.answer,
      explanation: q.explanation ?? "",
    })) ?? [],
  );

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

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) => {
      const title = String(formData.get("title") ?? "").trim();
      const instructions = String(formData.get("instructions") ?? "").trim();
      const dueAtRaw = String(formData.get("dueAt") ?? "");
      const dueAt = dueAtRaw ? new Date(dueAtRaw).toISOString() : undefined;

      const validQuestions = questions.filter((q) => q.stem.trim() && q.answer.trim() && q.options.every((o) => o.trim()));
      const content =
        validQuestions.length > 0
          ? {
              questions: validQuestions.map((q) => ({
                stem: q.stem.trim(),
                options: q.options.map((o) => o.trim()) as [string, string, string, string],
                answer: q.answer.trim(),
                explanation: q.explanation.trim() || undefined,
              })),
            }
          : undefined;

      if (assignment) {
        return updateAssignment(institutionSlug, {
          assignmentId: assignment.id,
          title,
          instructions: instructions || undefined,
          dueAt,
          content,
        });
      }

      return createAssignment(institutionSlug, {
        classSectionId: sectionId,
        subjectId,
        title,
        instructions: instructions || undefined,
        dueAt,
        content,
        aiGenerated: false,
      });
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.push(`/${institutionSlug}/assignments/${state.data.id}`);
    }
  }, [state, institutionSlug, router]);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      {!isEditing && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium" htmlFor="classSectionId">
              Section
            </label>
            <Select
              value={sectionId}
              onValueChange={(value) => {
                setSectionId(value);
                const next = sections.find((s) => s.id === value);
                setSubjectId(next?.subjects[0]?.id ?? "");
              }}
            >
              <SelectTrigger id="classSectionId" className="w-full">
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
          <div>
            <label className="text-sm font-medium" htmlFor="subjectId">
              Subject
            </label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger id="subjectId" className="w-full">
                <SelectValue placeholder="Choose a subject" />
              </SelectTrigger>
              <SelectContent>
                {(section?.subjects ?? []).map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium" htmlFor="title">
          Title
        </label>
        <Input id="title" name="title" required defaultValue={assignment?.title} maxLength={200} />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="instructions">
          Instructions
        </label>
        <textarea
          id="instructions"
          name="instructions"
          defaultValue={assignment?.instructions ?? ""}
          className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="dueAt">
          Due date
        </label>
        <Input
          id="dueAt"
          name="dueAt"
          type="date"
          defaultValue={assignment?.dueAt ? assignment.dueAt.slice(0, 10) : undefined}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Quiz questions (optional)</h2>
          <Button type="button" size="sm" variant="outline" onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}>
            Add question
          </Button>
        </div>

        {questions.map((question, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Question {index + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setQuestions((qs) => qs.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
            <Input
              placeholder="Question text"
              value={question.stem}
              onChange={(e) => updateQuestion(index, { stem: e.target.value })}
            />
            {question.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${index}`}
                  aria-label={`Option ${optionIndex + 1} is correct`}
                  checked={option !== "" && option === question.answer}
                  onChange={() => updateQuestion(index, { answer: option })}
                />
                <Input
                  placeholder={`Option ${optionIndex + 1}`}
                  value={option}
                  onChange={(e) => updateOption(index, optionIndex, e.target.value)}
                />
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

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}

      <Button type="submit" disabled={pending || (!isEditing && (!sectionId || !subjectId))}>
        {pending ? "Saving…" : isEditing ? "Save changes" : "Create draft"}
      </Button>
    </form>
  );
}
