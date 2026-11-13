"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPager } from "@/components/list-pager";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BarList } from "@/components/widgets/viz";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { approveQuestion, archiveQuestion, duplicateQuestion, rejectQuestion, setPracticeAllowed, submitForReview } from "@/modules/question-bank/actions";
import type { CollectionItem, NearDuplicate, QuestionBankItem, QuestionCollection } from "@/modules/question-bank/queries";
import { QuestionOriginSchema, QuestionStatusSchema } from "@/modules/question-bank/schemas";
import { AddToCollectionDialog, CollectionsPanel } from "./CollectionsPanel";
import { GenerateFromTextbook } from "./GenerateFromTextbook";
import { ExportDialog, ImportDialog } from "./ImportExport";
import { QuestionForm } from "./QuestionForm";
import { WhereUsed } from "./WhereUsed";
import { DIFFICULTIES, ORIGIN_LABEL, STATUS_LABEL, STATUS_VARIANT, TYPES, typeLabel, type PairMeta } from "./question-meta";

const ALL = "all";

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-40" aria-label={label}><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function QuestionBankView({
  institutionSlug,
  items,
  total,
  page,
  pageSize,
  queue,
  stems,
  filters,
  pairs,
  filterTopics,
  canManage,
  canApprove,
  collections,
  collectionItems,
}: {
  institutionSlug: string;
  /** One server page of the filtered list. */
  items: QuestionBankItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Drafts and in-review questions, regardless of the list filters. */
  queue: QuestionBankItem[];
  /** Passage and case-based stems a question can hang under. */
  stems: QuestionBankItem[];
  filters: { status?: string; type?: string; difficulty?: string; origin?: string; topic?: string };
  pairs: PairMeta[];
  /** Every topic of the subjects shown (a reviewer with no classes still filters by topic). */
  filterTopics: { value: string; label: string }[];
  canManage: boolean;
  canApprove: boolean;
  collections: QuestionCollection[];
  collectionItems: Record<string, CollectionItem[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<QuestionBankItem | null | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [rejecting, setRejecting] = useState<QuestionBankItem | null>(null);
  const [note, setNote] = useState("");
  const [dupes, setDupes] = useState<NearDuplicate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const f = { status: filters.status ?? ALL, type: filters.type ?? ALL, difficulty: filters.difficulty ?? ALL, origin: filters.origin ?? ALL, topic: filters.topic ?? ALL };
  const canAuthor = canManage && pairs.length > 0;
  const visible = items;
  const filtering = Object.values(f).some((v) => v !== ALL);

  // Filters live in the URL and run in SQL; changing one returns to page 1.
  function setFilters(next: Partial<typeof f> | "clear") {
    const merged: Record<string, string | undefined> = next === "clear" ? {} : { ...f, ...next };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && v !== ALL) sp.set(k, v);
    router.push(`?${sp.toString()}`);
  }

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof actionErrorMessage>[0] }>, done: string, after?: (data: T) => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(actionErrorMessage(r.error));
      toast.success(done);
      after?.(r.data);
      router.refresh();
    });
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  function renderRow(q: QuestionBankItem, queueMode: boolean) {
    const reviewable = canApprove && (q.status === "draft" || q.status === "in_review");
    return (
      <li key={q.id} data-testid="question-row" className="rounded-md border bg-card p-3">
        <div className="flex items-start gap-3">
          {!queueMode && (
            <input type="checkbox" className="mt-1.5" aria-label="Select question" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="line-clamp-3 whitespace-pre-line text-sm">{q.body}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant={STATUS_VARIANT[q.status]}>{STATUS_LABEL[q.status]}</Badge>
              {q.origin === "ai" && <Badge variant="info">AI-written{q.aiModel ? ` · ${q.aiModel}` : ""}</Badge>}
              {q.origin === "import" && <Badge variant="outline">{ORIGIN_LABEL.import}</Badge>}
              {q.stemQuestionId && <Badge variant="outline">Part of a passage</Badge>}
              <span>{q.gradeCode} · {q.subjectName}</span>
              <span>{typeLabel(q.type)}</span>
              <span className="capitalize">{q.difficulty}</span>
              <span className="tabular-nums">{q.marks} marks</span>
              {q.topicTitle && <span>Topic: {q.topicTitle}</span>}
              {!q.practiceAllowed && <Badge variant="outline">Hidden from practice</Badge>}
              {q.version > 1 && <span className="tabular-nums">v{q.version}</span>}
            </div>
            {queueMode && (
              <p className="text-xs"><span className="text-muted-foreground">Answer: </span>{q.answer}{q.explanation ? <span className="text-muted-foreground"> · {q.explanation}</span> : null}</p>
            )}
            {q.reviewNote && (q.status === "rejected" || q.status === "approved") && <p className="text-xs text-muted-foreground">Reviewer note: {q.reviewNote}</p>}
          </div>
        </div>
        {canManage && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {reviewable && (
              <>
                <Button size="sm" disabled={pending} onClick={() => run(() => approveQuestion(institutionSlug, { id: q.id }), "Question approved")}>Approve</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => { setNote(""); setRejecting(q); }}>Reject</Button>
              </>
            )}
            {!queueMode && (q.status === "draft" || q.status === "rejected") && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => submitForReview(institutionSlug, { id: q.id }), "Sent for review")}>Submit for review</Button>
            )}
            {q.status !== "archived" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(q); setFormOpen(true); }}>Edit</Button>
            )}
            {!queueMode && <WhereUsed institutionSlug={institutionSlug} questionId={q.id} />}
            {!queueMode && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPracticeAllowed(institutionSlug, { id: q.id, practiceAllowed: !q.practiceAllowed }), q.practiceAllowed ? "Hidden from student practice" : "Allowed in student practice")}>
                {q.practiceAllowed ? "Hide from practice" : "Allow in practice"}
              </Button>
            )}
            {!queueMode && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => duplicateQuestion(institutionSlug, { id: q.id }), "Copied as a new draft")}>Duplicate</Button>
            )}
            {!queueMode && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveQuestion(institutionSlug, { id: q.id, isActive: q.status === "archived" }), q.status === "archived" ? "Question restored" : "Question archived")}>
                {q.status === "archived" ? "Restore" : "Archive"}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }

  const list = (rows: QuestionBankItem[], queueMode: boolean) => (
    <ul className="space-y-2" aria-label={queueMode ? "Questions waiting for review" : "Questions"}>
      {rows.map((q) => renderRow(q, queueMode))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          {canApprove && <TabsTrigger value="review">Review queue{queue.length > 0 ? ` (${queue.length})` : ""}</TabsTrigger>}
          {canAuthor && <TabsTrigger value="generate">From textbook</TabsTrigger>}
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="questions" className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setExportOpen(true)}>Export CSV</Button>
            {canAuthor && <Button variant="outline" onClick={() => setImportOpen(true)}>Import CSV</Button>}
            {canAuthor && <Button onClick={openNew}>New question</Button>}
          </div>
          {dupes.length > 0 && (
            <div role="status" data-testid="duplicate-warning" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">Saved. {dupes.length === 1 ? "A similar question already exists" : `${dupes.length} similar questions already exist`} in the bank:</p>
              <ul className="mt-1 list-disc pl-5">
                {dupes.map((d) => <li key={d.questionId}><span className="line-clamp-1">{d.body}</span> <span className="text-xs tabular-nums text-muted-foreground">({Math.round(d.similarity * 100)}% alike)</span></li>)}
              </ul>
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => setDupes([])}>Dismiss</Button>
            </div>
          )}
          {items.length === 0 && !filtering ? (
            <EmptyState
              title="No questions yet"
              description={canAuthor ? "Add questions for the grades and subjects you teach, then reuse them in assignments and exams." : "Questions for your subjects appear here."}
              action={canAuthor ? <Button onClick={openNew}>New question</Button> : undefined}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
                <Filter label="Status" value={f.status} onChange={(status) => setFilters({ status })} options={QuestionStatusSchema.options.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
                <Filter label="Type" value={f.type} onChange={(type) => setFilters({ type })} options={TYPES} />
                <Filter label="Difficulty" value={f.difficulty} onChange={(difficulty) => setFilters({ difficulty })} options={DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} />
                <Filter label="Origin" value={f.origin} onChange={(origin) => setFilters({ origin })} options={QuestionOriginSchema.options.map((o) => ({ value: o, label: ORIGIN_LABEL[o] }))} />
                {filterTopics.length > 0 && <Filter label="Topic" value={f.topic} onChange={(topic) => setFilters({ topic })} options={filterTopics} />}
                {filtering && <Button variant="ghost" size="sm" onClick={() => setFilters("clear")}>Clear filters</Button>}
              </div>
              <div className="max-w-xl">
                <p className="mb-1 text-sm font-medium">Difficulty mix (this page)</p>
                <BarList
                  ariaLabel="Questions shown by difficulty"
                  max={Math.max(visible.length, 1)}
                  items={DIFFICULTIES.map((d) => ({ label: d.charAt(0).toUpperCase() + d.slice(1), value: visible.filter((q) => q.difficulty === d).length }))}
                />
              </div>
              {selected.length > 0 && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
                  <span className="tabular-nums">{selected.length} selected</span>
                  <Button size="sm" onClick={() => setAddOpen(true)}>Add to collection</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
                </div>
              )}
              {visible.length === 0 ? <EmptyState title="No questions match these filters" description="Clear a filter to see more." /> : list(visible, false)}
              <ListPager basePath="" params={{ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ALL)) }} page={page} total={total} pageSize={pageSize} noun="questions" />
              <p className="text-xs tabular-nums text-muted-foreground">Showing {visible.length} of {total}</p>
            </>
          )}
        </TabsContent>

        {canApprove && (
          <TabsContent value="review" className="space-y-3">
            {queue.length === 0 ? <EmptyState title="Nothing to review" description="AI-written, imported and submitted questions wait here for approval." /> : list(queue, true)}
          </TabsContent>
        )}

        {canAuthor && (
          <TabsContent value="generate">
            <GenerateFromTextbook institutionSlug={institutionSlug} pairs={pairs} onSaved={() => router.refresh()} />
          </TabsContent>
        )}

        <TabsContent value="collections">
          <CollectionsPanel institutionSlug={institutionSlug} collections={collections} items={collectionItems} />
        </TabsContent>
      </Tabs>

      {canAuthor && (
        <QuestionForm
          institutionSlug={institutionSlug}
          pairs={pairs}
          stems={stems}
          editing={editing}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={(warnings) => { setFormOpen(false); setDupes(warnings); router.refresh(); }}
        />
      )}
      {canAuthor && <ImportDialog institutionSlug={institutionSlug} pairs={pairs} open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); router.refresh(); }} />}
      <ExportDialog institutionSlug={institutionSlug} pairs={pairs} open={exportOpen} onClose={() => setExportOpen(false)} />
      <AddToCollectionDialog
        institutionSlug={institutionSlug}
        collections={collections}
        questionIds={selected}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => { setAddOpen(false); setSelected([]); router.refresh(); }}
      />

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject question</DialogTitle><DialogDescription>The author sees your note and can fix the question and send it again.</DialogDescription></DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rejecting) return;
              const id = rejecting.id;
              run(() => rejectQuestion(institutionSlug, { id, note }), "Question rejected", () => setRejecting(null));
            }}
          >
            <label className="block space-y-1 text-sm">Why is it being rejected?<Textarea required rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" disabled={pending || !note.trim()}>Reject</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
