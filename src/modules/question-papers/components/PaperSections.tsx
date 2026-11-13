"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { typeLabel } from "@/modules/question-bank/components/question-meta";
import {
  addItemsFromBank, addManualItem, addSection, removeItem, removeSection, reorderItems, reorderSections, replaceItem, setChoiceGroup, updateItem, updateSection,
} from "@/modules/question-papers/actions";
import type { PaperDetail, PaperItem, PaperSection } from "@/modules/question-papers/queries";
import { BankPicker } from "./BankPicker";
import { ItemForm, blankDraft, draftFromItem, toPayload } from "./ItemForm";
import { fmtMarks, run } from "./paper-ui";

type Picker = { sectionId: string; replaceId?: string } | null;

export function PaperSections({ institutionSlug, paper, editable }: { institutionSlug: string; paper: PaperDetail; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const inPaper = useMemo(() => new Set(paper.sections.flatMap((s) => s.items.map((i) => i.sourceQuestionId).filter((x): x is string => !!x))), [paper]);
  const nextGroup = Math.max(0, ...paper.sections.flatMap((s) => s.items.map((i) => i.choiceGroup ?? 0))) + 1;

  async function act(fn: () => Promise<ActionResult<unknown>>, done?: string): Promise<boolean> {
    setBusy(true);
    const r = await run(fn());
    setBusy(false);
    if (r === null) return false;
    if (done) toast.success(done);
    router.refresh();
    return true;
  }

  const swap = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  };

  const moveSection = (i: number, d: -1 | 1) => act(() => reorderSections(institutionSlug, { paperId: paper.id, sectionIds: swap(paper.sections, i, d).map((s) => s.id) }));
  const moveItem = (s: PaperSection, i: number, d: -1 | 1) => act(() => reorderItems(institutionSlug, { sectionId: s.id, itemIds: swap(s.items, i, d).map((x) => x.id) }));

  function drop(target: PaperSection, before: string | null) {
    const id = dragId;
    setDragId(null);
    if (!id || id === before) return;
    const ids = target.items.map((i) => i.id).filter((x) => x !== id);
    ids.splice(before ? ids.indexOf(before) : ids.length, 0, id);
    void act(() => reorderItems(institutionSlug, { sectionId: target.id, itemIds: ids }));
  }

  function group(section: PaperSection, ids: string[], on: boolean) {
    const inSec = ids.filter((id) => section.items.some((i) => i.id === id));
    if (on && inSec.length < 2) return toast.error("Select at least two questions in this section.");
    void act(() => setChoiceGroup(institutionSlug, { itemIds: inSec, choiceGroup: on ? nextGroup : null }), on ? "Grouped as OR." : "Ungrouped.").then(() => setSelected([]));
  }

  return (
    <div className="space-y-4">
      {paper.sections.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No sections yet. Add one below, or fill the paper from its blueprint.</p>}
      {paper.sections.map((s, si) => (
        <section
          key={s.id}
          data-testid="paper-section"
          aria-label={s.title}
          className="space-y-2 rounded-lg border bg-card p-3"
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); drop(s, null); }}
        >
          <SectionHead s={s} editable={editable} busy={busy} first={si === 0} last={si === paper.sections.length - 1} onMove={(d) => moveSection(si, d)}
            onSave={(patch) => act(() => updateSection(institutionSlug, { id: s.id, ...patch }))}
            onRemove={() => confirm(`Remove "${s.title}" and its questions?`) && act(() => removeSection(institutionSlug, { id: s.id }))} />
          <ol className="space-y-2">
            {s.items.map((it, i) => (
              <li key={it.id} data-testid="paper-item" draggable={editable && editing !== it.id} onDragStart={() => setDragId(it.id)} onDragEnd={() => setDragId(null)}
                onDragOver={(e) => dragId && e.preventDefault()} onDrop={(e) => { e.stopPropagation(); e.preventDefault(); drop(s, it.id); }}>
                {it.choiceGroup != null && s.items[i - 1]?.choiceGroup === it.choiceGroup && <p className="py-0.5 text-center text-xs font-semibold tracking-wide text-muted-foreground">OR</p>}
                {editing === it.id ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <ItemForm initial={draftFromItem(it)} lockType submitLabel="Save question" busy={busy} onCancel={() => setEditing(null)}
                      onSubmit={(d) => act(() => updateItem(institutionSlug, { id: it.id, item: toPayload(d, it) }), "Question saved.").then((ok) => ok && setEditing(null))} />
                  </div>
                ) : (
                  <ItemRow it={it} n={i + 1} editable={editable} busy={busy} selected={selected.includes(it.id)} first={i === 0} last={i === s.items.length - 1}
                    onSelect={() => setSelected((p) => (p.includes(it.id) ? p.filter((x) => x !== it.id) : [...p, it.id]))}
                    onMove={(d) => moveItem(s, i, d)} onEdit={() => setEditing(it.id)} onReplace={() => setPicker({ sectionId: s.id, replaceId: it.id })}
                    onRemove={() => act(() => removeItem(institutionSlug, { id: it.id }))}
                    onMarks={(m) => act(() => updateItem(institutionSlug, { id: it.id, item: toPayload({ ...draftFromItem(it), marks: String(m) }, it) }))} />
                )}
              </li>
            ))}
            {s.items.length === 0 && <li className="text-sm text-muted-foreground">No questions in this section yet.</li>}
          </ol>
          {editable && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setPicker({ sectionId: s.id })}><Plus className="size-4" aria-hidden /> From bank</Button>
              <Button size="sm" variant="outline" onClick={() => setManualFor(s.id)}><Plus className="size-4" aria-hidden /> Write a question</Button>
              {s.items.some((i) => selected.includes(i.id)) && (
                <>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => group(s, selected, true)}>Group selected as OR</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => group(s, selected, false)}>Ungroup selected</Button>
                </>
              )}
            </div>
          )}
        </section>
      ))}

      {editable && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) void act(() => addSection(institutionSlug, { paperId: paper.id, title: newTitle.trim() })).then((ok) => ok && setNewTitle("")); }}>
          <Input className="min-w-48 flex-1" aria-label="New section title" placeholder="New section title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Button type="submit" variant="outline" disabled={busy || !newTitle.trim()}>Add section</Button>
        </form>
      )}

      {picker && (
        <BankPicker institutionSlug={institutionSlug} gradeId={paper.gradeId} subjectId={paper.subjectId} open single={!!picker.replaceId} busy={busy} excludeIds={inPaper} onClose={() => setPicker(null)}
          onPick={(ids) =>
            act(() => (picker.replaceId ? replaceItem(institutionSlug, { id: picker.replaceId, questionId: ids[0] }) : addItemsFromBank(institutionSlug, { sectionId: picker.sectionId, questionIds: ids })),
              picker.replaceId ? "Question replaced." : "Added to the paper.").then((ok) => ok && setPicker(null))} />
      )}
      <Dialog open={!!manualFor} onOpenChange={(o) => !o && setManualFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Write a question</DialogTitle></DialogHeader>
          {manualFor && (
            <ItemForm initial={blankDraft()} lockType={false} submitLabel="Add to paper" busy={busy} onCancel={() => setManualFor(null)}
              onSubmit={(d) => act(() => addManualItem(institutionSlug, { sectionId: manualFor, item: toPayload(d) }), "Question added.").then((ok) => ok && setManualFor(null))} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionHead({ s, editable, busy, first, last, onMove, onSave, onRemove }: {
  s: PaperSection; editable: boolean; busy: boolean; first: boolean; last: boolean;
  onMove: (d: -1 | 1) => void; onSave: (p: { title?: string; chooseCount?: number | null; instructions?: string | null }) => void; onRemove: () => void;
}) {
  const total = s.items.reduce((t, i) => t + i.marks, 0);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-40 flex-1">
        {editable ? (
          <Input aria-label="Section title" className="font-semibold" defaultValue={s.title} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && onSave({ title: e.target.value.trim() })} />
        ) : (
          <h3 className="font-semibold">{s.title}</h3>
        )}
      </div>
      {editable ? (
        <label className="flex items-center gap-1.5 text-sm">
          Attempt any
          <Input aria-label={`${s.title} attempt any`} className="w-16" inputMode="numeric" placeholder="all" defaultValue={s.chooseCount ?? ""}
            onBlur={(e) => { const v = e.target.value.replace(/\D/g, ""); const n = v ? Number(v) : null; if (n !== s.chooseCount) onSave({ chooseCount: n }); }} />
        </label>
      ) : (
        s.chooseCount && <Badge variant="outline">Attempt any {s.chooseCount}</Badge>
      )}
      <span className="pb-2 text-sm text-muted-foreground">{fmtMarks(total)} marks</span>
      {editable && (
        <div className="flex gap-1 pb-0.5">
          <Button size="icon" variant="ghost" aria-label={`Move ${s.title} up`} disabled={first || busy} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={`Move ${s.title} down`} disabled={last || busy} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={`Remove ${s.title}`} disabled={busy} onClick={onRemove}><Trash2 className="size-4" /></Button>
        </div>
      )}
    </div>
  );
}

function ItemRow({ it, n, editable, busy, selected, first, last, onSelect, onMove, onEdit, onReplace, onRemove, onMarks }: {
  it: PaperItem; n: number; editable: boolean; busy: boolean; selected: boolean; first: boolean; last: boolean;
  onSelect: () => void; onMove: (d: -1 | 1) => void; onEdit: () => void; onReplace: () => void; onRemove: () => void; onMarks: (m: number) => void;
}) {
  return (
    <div className={`flex gap-2 rounded-lg border p-2.5 ${it.choiceGroup != null ? "border-l-4 border-l-primary/60" : ""}`}>
      {editable && (
        <div className="flex flex-col items-center gap-1">
          <GripVertical className="hidden size-4 cursor-grab text-muted-foreground sm:block" aria-hidden />
          <input type="checkbox" aria-label={`Select question ${n} for OR grouping`} checked={selected} onChange={onSelect} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm"><span className="font-medium">Q{n}.</span> <span className="whitespace-pre-wrap">{it.body}</span></p>
        {Array.isArray(it.options) && <ol className="ml-5 list-[upper-alpha] text-sm text-muted-foreground">{(it.options as string[]).map((o, i) => <li key={i}>{o}</li>)}</ol>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{typeLabel(it.type)}</Badge>
          <span>{it.difficulty}</span>
          {it.sourceQuestionId == null && <Badge variant="secondary">Written for this paper</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {editable ? (
          <label className="flex items-center gap-1 text-xs">
            Marks
            <Input aria-label={`Marks for question ${n}`} className="h-8 w-16" inputMode="decimal" defaultValue={fmtMarks(it.marks)} key={it.marks}
              onBlur={(e) => { const m = Number(e.target.value); if (m > 0 && m !== it.marks) onMarks(m); else e.target.value = fmtMarks(it.marks); }} />
          </label>
        ) : (
          <span className="text-sm font-medium">{fmtMarks(it.marks)}</span>
        )}
        {editable && (
          <div className="flex flex-wrap justify-end gap-0.5">
            <Button size="icon" variant="ghost" className="size-8" aria-label={`Move question ${n} up`} disabled={first || busy} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label={`Move question ${n} down`} disabled={last || busy} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove question ${n}`} disabled={busy} onClick={onRemove}><Trash2 className="size-4" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}
