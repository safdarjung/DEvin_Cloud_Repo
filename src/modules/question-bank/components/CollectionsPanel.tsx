"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { addToCollection, createCollection, deleteCollection, removeFromCollection } from "@/modules/question-bank/collections.actions";
import type { CollectionItem, QuestionCollection } from "@/modules/question-bank/queries";
import { typeLabel } from "./question-meta";

type Visibility = "private" | "school";

export function CollectionsPanel({ institutionSlug, collections, items }: { institutionSlug: string; collections: QuestionCollection[]; items: Record<string, CollectionItem[]> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof actionErrorMessage>[0] }>, done: string, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(actionErrorMessage(r.error));
      toast.success(done);
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}>New collection</Button></div>
      {collections.length === 0 ? (
        <EmptyState title="No collections yet" description="Group questions you reuse, such as a revision set, then add them from the question list." />
      ) : (
        <ul className="space-y-2">
          {collections.map((c) => {
            const list = items[c.id] ?? [];
            const expanded = open === c.id;
            return (
              <li key={c.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                    <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{c.itemCount} questions</span>
                      <Badge variant={c.visibility === "school" ? "info" : "outline"}>{c.visibility === "school" ? "Shared with school" : "Private"}</Badge>
                      {!c.isMine && <Badge variant="secondary">Shared by a colleague</Badge>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>{expanded ? "Hide" : "View"}</Button>
                    {c.isMine && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm(`Delete "${c.name}"? The questions stay in the bank.`) && run(() => deleteCollection(institutionSlug, { id: c.id }), "Collection deleted")}>Delete</Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <ul className="mt-3 divide-y border-t">
                    {list.length === 0 && <li className="py-3 text-sm text-muted-foreground">This collection is empty.</li>}
                    {list.map((it) => (
                      <li key={it.questionId} className="flex items-start justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0">
                          {it.question ? (
                            <>
                              <span className="line-clamp-2">{it.question.body}</span>
                              <span className="text-xs text-muted-foreground">{it.question.gradeCode} · {it.question.subjectName} · {typeLabel(it.question.type)} · {it.question.marks} marks</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">A question outside your subjects</span>
                          )}
                        </span>
                        {c.isMine && (
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeFromCollection(institutionSlug, { collectionId: c.id, questionIds: [it.questionId] }), "Removed from collection")}>Remove</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New collection</DialogTitle><DialogDescription>A named set of questions you can reuse.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => createCollection(institutionSlug, { name, description: description || null, visibility }), "Collection created", () => { setCreating(false); setName(""); setDescription(""); }); }}>
            <label className="block space-y-1 text-sm">Name<Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block space-y-1 text-sm">Description (optional)<Textarea rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <label className="block space-y-1 text-sm">Who can see it
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="private">Only me</SelectItem><SelectItem value="school">Staff of the school</SelectItem></SelectContent>
              </Select>
            </label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={pending}>Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AddToCollectionDialog({ institutionSlug, collections, questionIds, open, onClose, onDone }: { institutionSlug: string; collections: QuestionCollection[]; questionIds: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const mine = collections.filter((c) => c.isMine);
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();
  const chosen = target || mine[0]?.id || "";

  function add() {
    start(async () => {
      const r = await addToCollection(institutionSlug, { collectionId: chosen, questionIds });
      if (!r.ok) return void toast.error(actionErrorMessage(r.error));
      toast.success(`${questionIds.length} added to the collection`);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add to collection</DialogTitle><DialogDescription>{questionIds.length} selected questions.</DialogDescription></DialogHeader>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no collections yet. Create one in the Collections tab first.</p>
        ) : (
          <Select value={chosen} onValueChange={setTarget}>
            <SelectTrigger className="w-full" aria-label="Collection"><SelectValue /></SelectTrigger>
            <SelectContent>{mine.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={pending || !chosen} onClick={add}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
