"use client";

// Fills blueprint gaps with AI drafts (rule 6): each draft is saved as a DRAFT
// bank question via createQuestion (origin "ai"), then added to the paper.
// Approval stays blocked until the bank approves those questions.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import { createQuestion } from "@/modules/question-bank/actions";
import { typeLabel } from "@/modules/question-bank/components/question-meta";
import type { QuestionCreateInput, QuestionType } from "@/modules/question-bank/schemas";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { addItemsFromBank, type GenerationGap } from "@/modules/question-papers/actions";

const GROUNDED = ["mcq", "true_false", "very_short_answer", "short_answer", "long_answer", "fill_blank", "multi_select", "assertion_reason"];
const MAX_PER_CALL = 10;

export interface GapSource { bookId?: string; chapterNos?: number[]; unitId?: string; topicIds?: string[] }
interface GenResponse { grounded: boolean; note: string | null; drafts: QuestionCreateInput[]; dropped: number }

export function GapFill({
  institutionSlug,
  paper,
  gaps,
  source,
  onDone,
}: {
  institutionSlug: string;
  paper: { id: string; gradeId: string; subjectId: string };
  gaps: GenerationGap[];
  source: GapSource;
  onDone: (remaining: GenerationGap[]) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ungrounded, setUngrounded] = useState(false);

  async function fill(index: number) {
    const gap = gaps[index];
    setBusy(index);
    setNote(null);
    const res = await postAiTask<GenResponse>("/api/ai/questions-generate", {
      institutionSlug,
      gradeId: paper.gradeId,
      subjectId: paper.subjectId,
      subjectTextbookId: source.bookId,
      chapterNos: source.chapterNos,
      curriculumUnitId: source.unitId,
      topicIds: source.topicIds,
      types: [gap.type],
      count: Math.min(gap.missing, MAX_PER_CALL),
      marksEach: gap.marks,
      difficulty: gap.difficulty ?? "medium",
      allowUngrounded: ungrounded,
    });
    if (!res.ok) {
      setBusy(null);
      return toast.error(res.message);
    }
    if (res.data.drafts.length === 0) {
      setBusy(null);
      return setNote(res.data.note ?? "The assistant produced no usable questions.");
    }
    const ids: string[] = [];
    for (const draft of res.data.drafts) {
      const saved = await createQuestion(institutionSlug, { ...draft, origin: "ai" });
      if (!saved.ok) {
        toast.error(actionErrorMessage(saved.error));
        break;
      }
      ids.push((saved.data as { id: string }).id);
    }
    let added = 0;
    if (ids.length) {
      const r = await addItemsFromBank(institutionSlug, { sectionId: gap.sectionId, questionIds: ids });
      if (r.ok) added = r.data.itemIds.length;
      else toast.error(actionErrorMessage(r.error));
    }
    setBusy(null);
    if (added) {
      toast.success(`Added ${added} AI draft${added === 1 ? "" : "s"}. They need approval in the question bank.`);
      onDone(gaps.map((g, i) => (i === index ? { ...g, missing: g.missing - added } : g)).filter((g) => g.missing > 0));
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3" data-testid="gap-fill">
      <p className="text-sm font-medium">Not enough approved questions for:</p>
      <ul className="space-y-1.5">
        {gaps.map((g, i) => {
          const can = GROUNDED.includes(g.type);
          return (
            <li key={`${g.sectionId}-${g.type}-${g.marks}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {g.sectionTitle}: {g.missing} × {typeLabel(g.type as QuestionType)}, {g.marks} mark{g.marks === 1 ? "" : "s"}{g.difficulty ? `, ${g.difficulty}` : ""}
              </span>
              <Button size="sm" variant="outline" disabled={!can || busy !== null} onClick={() => fill(i)} title={can ? undefined : "AI cannot write this type; add it by hand."}>
                {busy === i ? "Writing…" : can ? "Fill gaps with AI" : "Add by hand"}
              </Button>
            </li>
          );
        })}
      </ul>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={ungrounded} onChange={(e) => setUngrounded(e.target.checked)} />
        Allow drafts that are not grounded in your textbooks
      </label>
      {note && <p role="status" className="text-sm text-muted-foreground">{note}</p>}
      <p className="text-xs text-muted-foreground">AI drafts are saved to the question bank as drafts. Review and approve them there before this paper can be approved.</p>
    </div>
  );
}
