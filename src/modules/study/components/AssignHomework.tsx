"use client";

// Assign a studio item or worksheet to a section as homework (0140) through
// study.teacher.assign, which calls the existing assignment.create (and
// assignment.publish) actions. A worksheet goes in as text (one level or all
// three, never the answer key); other items are shared and linked.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { assignStudyMaterial } from "@/modules/study/help.actions";
import { LEVEL_LABELS, WORKSHEET_LEVELS, type WorksheetLevel } from "@/modules/study/worksheet";

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AssignHomework({
  institutionSlug,
  materialId,
  isWorksheet,
  subjectId,
  pairs,
}: {
  institutionSlug: string;
  materialId: string;
  isWorksheet: boolean;
  subjectId: string | null;
  /** (section, subject) pairs the teacher teaches, labelled. */
  pairs: { sectionId: string; sectionLabel: string; subjectId: string; subjectName: string }[];
}) {
  const router = useRouter();
  const options = subjectId ? pairs.filter((p) => p.subjectId === subjectId) : pairs;
  const [choice, setChoice] = useState(options[0] ? `${options[0].sectionId}:${options[0].subjectId}` : "");
  const [level, setLevel] = useState<WorksheetLevel | "all">("all");
  const [due, setDue] = useState("");
  const [publish, setPublish] = useState(true);
  const [pending, start] = useTransition();

  if (options.length === 0) return <p className="text-xs text-muted-foreground">You teach no section in this subject, so it cannot be assigned.</p>;
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="min-h-10 cursor-pointer py-1 text-sm font-medium">Assign as homework</summary>
      <form
        className="mt-2 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const [sectionId, subject] = choice.split(":");
          start(async () => {
            const res = await assignStudyMaterial(institutionSlug, {
              materialId,
              sectionId: sectionId!,
              subjectId: subject!,
              publish,
              ...(isWorksheet ? { level } : {}),
              ...(due ? { dueAt: new Date(`${due}T23:59:00+05:30`).toISOString() } : {}),
            });
            if (!res.ok) {
              toast.error(describeActionError(res.error));
              return;
            }
            toast.success(res.data.published ? "Assigned and published to the section." : "Saved as a draft assignment.");
            router.refresh();
          });
        }}
      >
        <label className="text-sm">
          Section and subject
          <select className={selectClass} value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((p) => (
              <option key={`${p.sectionId}:${p.subjectId}`} value={`${p.sectionId}:${p.subjectId}`}>
                {p.sectionLabel} · {p.subjectName}
              </option>
            ))}
          </select>
        </label>
        {isWorksheet && (
          <label className="text-sm">
            Level
            <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as WorksheetLevel | "all")}>
              <option value="all">All three levels</option>
              {WORKSHEET_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Due date (optional)
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={selectClass} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          Publish now (otherwise a draft on Assignments)
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending || !choice}>
            {pending ? "Assigning…" : "Assign"}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            {isWorksheet ? "Students get the questions only; the answer key stays with you." : "Shared with the section and linked from the assignment."}
          </p>
        </div>
      </form>
    </details>
  );
}
