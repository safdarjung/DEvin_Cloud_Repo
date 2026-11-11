"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedList } from "@/components/widgets/viz";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { deleteDiaryEntry, postDiaryEntry } from "@/modules/diary/actions";
import type { DiaryEntryRow } from "@/modules/diary/queries";
import { TranslateButton } from "@/modules/ai/components/TranslateButton";

const ANY_SUBJECT = "any";
const dateLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (iso: string) => dateLabel.format(new Date(`${iso}T00:00:00Z`));

export function DiaryView({
  institutionSlug,
  classSectionId,
  sectionLabel,
  today,
  subjects,
  entries,
  canTranslate = false,
}: {
  institutionSlug: string;
  classSectionId: string;
  sectionLabel: string;
  today: string;
  subjects: { id: string; name: string }[];
  entries: DiaryEntryRow[];
  /** Shows the AI translate control only; the route re-checks. */
  canTranslate?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subjectId, setSubjectId] = useState(ANY_SUBJECT);
  const [entryDate, setEntryDate] = useState(today);
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function post() {
    setError(null);
    start(async () => {
      const result = await postDiaryEntry(institutionSlug, {
        classSectionId,
        entryDate,
        body,
        requiresAck,
        ...(subjectId !== ANY_SUBJECT ? { subjectId } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      if (!result.ok) {
        const message = actionErrorMessage(result.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(`Posted to ${sectionLabel}`);
      setBody("");
      setDueDate("");
      setRequiresAck(false);
      router.refresh();
    });
  }

  function remove(entryId: string) {
    start(async () => {
      const result = await deleteDiaryEntry(institutionSlug, { entryId });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success("Entry deleted");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card>
        <CardHeader>
          <CardTitle>Post to {sectionLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              post();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Subject
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_SUBJECT}>General</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                Date
                <Input type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              Note for the class
              <Textarea required rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            {canTranslate && <TranslateButton institutionSlug={institutionSlug} text={body} onUse={setBody} />}
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <label className="space-y-1 text-sm">
                Due date (optional)
                <Input type="date" min={entryDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} className="size-4" />
                Ask parents to acknowledge
              </label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending || body.trim() === ""}>
              {pending ? "Posting…" : "Post entry"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState title="No diary entries in this window" description="Entries you post appear here and in the parents' portal." />
          ) : (
            <AnimatedList className="space-y-0 divide-y" ariaLabel="Diary entries">
              {entries.map((e) => (
                <div key={e.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="tabular-nums text-muted-foreground">{fmt(e.entryDate)}</span>
                      <Badge variant="outline">{e.subject?.name ?? "General"}</Badge>
                      {e.requiresAck && <Badge variant="info">{e.ackCount ?? 0} acknowledged</Badge>}
                    </div>
                    {e.isMine && (
                      <Button size="sm" variant="ghost" onClick={() => remove(e.id)} disabled={pending} aria-label={`Delete entry from ${fmt(e.entryDate)}`}>
                        Delete
                      </Button>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-sm">{e.body}</p>
                  {e.dueDate && <p className="text-xs text-muted-foreground">Due {fmt(e.dueDate)}</p>}
                </div>
              ))}
            </AnimatedList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
