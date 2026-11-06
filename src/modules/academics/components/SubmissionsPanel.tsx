"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { gradeSubmission } from "@/modules/academics/submissions.actions";
import type { SubmissionRosterRow } from "@/modules/academics/submissions.queries";

const stamp = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function answerText(content: SubmissionRosterRow["content"]): string | null {
  if (content && typeof content === "object" && !Array.isArray(content) && typeof content.text === "string") return content.text;
  return null;
}

function GradeRow({ institutionSlug, row, canGrade }: { institutionSlug: string; row: SubmissionRosterRow; canGrade: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [score, setScore] = useState(row.score === null ? "" : String(row.score));
  const [maxScore, setMaxScore] = useState(String(row.maxScore ?? 10));
  const [feedback, setFeedback] = useState(row.feedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const answer = answerText(row.content);

  function save() {
    if (!row.submissionId) return;
    const s = Number(score);
    const m = Number(maxScore);
    if (score.trim() === "" || Number.isNaN(s) || Number.isNaN(m)) {
      setError("Enter a score and a maximum.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await gradeSubmission(institutionSlug, {
        submissionId: row.submissionId!,
        score: s,
        maxScore: m,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      });
      if (!result.ok) {
        const message = actionErrorMessage(result.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(`Graded ${row.studentName}`);
      router.refresh();
    });
  }

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.studentName}</span>
          {row.rollNo !== null && <span className="text-xs tabular-nums text-muted-foreground">Roll {row.rollNo}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {row.submittedAt && <span>{stamp.format(new Date(row.submittedAt))}</span>}
          {row.isLate && <Badge variant="warning">Late</Badge>}
          {row.state === "graded" && <Badge variant="success">Graded</Badge>}
          {row.state === "submitted" && <Badge variant="info">To grade</Badge>}
          {row.state === "not_submitted" && <Badge variant="outline">Not submitted</Badge>}
        </div>
      </div>
      {answer && <p className="whitespace-pre-line rounded-md border p-3 text-sm">{answer}</p>}
      {row.documentCount > 0 && <p className="text-xs text-muted-foreground">{row.documentCount} attached file{row.documentCount === 1 ? "" : "s"}</p>}
      {canGrade && row.submissionId && (
        <form
          className="grid gap-3 sm:grid-cols-[6rem_6rem_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="space-y-1 text-xs text-muted-foreground">
            Score
            <Input type="number" inputMode="decimal" min={0} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} className="tabular-nums" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Out of
            <Input type="number" inputMode="decimal" min={0.01} max={1000} step="0.5" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} className="tabular-nums" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Feedback
            <Textarea rows={1} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : row.state === "graded" ? "Update grade" : "Save grade"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function SubmissionsPanel({
  institutionSlug,
  rows,
  canGrade,
}: {
  institutionSlug: string;
  rows: SubmissionRosterRow[];
  canGrade: boolean;
}) {
  const submitted = rows.filter((r) => r.state !== "not_submitted").length;
  const toGrade = rows.filter((r) => r.state === "submitted").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submissions</CardTitle>
        <p className="text-sm text-muted-foreground">
          {submitted} of {rows.length} submitted · {toGrade} to grade
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No students on this roster" description="Students appear here once they are enrolled in the section." />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <GradeRow key={r.studentId} institutionSlug={institutionSlug} row={r} canGrade={canGrade} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
