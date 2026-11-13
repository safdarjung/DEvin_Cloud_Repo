"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import type { CurriculumTopic } from "@/modules/academics/curriculum.queries";
import { deleteTopic, upsertTopic } from "@/modules/academics/topics.actions";

/** Topics and subtopics of one curriculum unit. Without `canManage` it is a read-only outline. */
export function TopicsManager({ institutionSlug, unitId, topics, canManage }: { institutionSlug: string; unitId: string; topics: CurriculumTopic[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const parents = topics.filter((t) => t.parentId === null);
  const nextSequence = (pid: string | null) => Math.max(0, ...topics.filter((t) => t.parentId === pid).map((t) => t.sequence)) + 1;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof actionErrorMessage>[0] }>, done: string, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(actionErrorMessage(r.error));
      toast.success(done);
      after?.();
      router.refresh();
    });
  }

  const row = (t: CurriculumTopic, sub: boolean) => (
    <li key={t.id} className={`flex min-h-10 items-center justify-between gap-2 py-1 text-sm ${sub ? "pl-6" : ""}`}>
      {editing?.id === t.id ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => upsertTopic(institutionSlug, { id: t.id, curriculumUnitId: unitId, parentId: t.parentId, title: editing.title, sequence: t.sequence }), "Topic renamed", () => setEditing(null));
          }}
        >
          <Input aria-label="Topic title" required maxLength={200} value={editing.title} onChange={(e) => setEditing({ id: t.id, title: e.target.value })} />
          <Button type="submit" size="sm" disabled={pending}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 truncate">{sub ? "↳ " : ""}{t.title}</span>
          {canManage && (
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id, title: t.title })}>Rename</Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => confirm(`Delete "${t.title}"${t.parentId ? "" : " and its subtopics"}? Questions keep their text but lose this topic.`) && run(() => deleteTopic(institutionSlug, { id: t.id }), "Topic deleted")}
              >
                Delete
              </Button>
            </span>
          )}
        </>
      )}
    </li>
  );

  return (
    <div className="space-y-3">
      {topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canManage ? "No topics yet. Add the first one below." : "No topics yet."}</p>
      ) : (
        <ul className="divide-y" aria-label="Topics">
          {parents.flatMap((p) => [row(p, false), ...topics.filter((t) => t.parentId === p.id).map((t) => row(t, true))])}
        </ul>
      )}
      {canManage && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => upsertTopic(institutionSlug, { curriculumUnitId: unitId, parentId: parentId || null, title, sequence: nextSequence(parentId || null) }), "Topic added", () => setTitle(""));
          }}
        >
          <Input aria-label="New topic title" placeholder="New topic" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select aria-label="Parent topic" className="h-9 rounded-md border bg-background px-2 text-sm" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Top-level topic</option>
            {parents.map((p) => <option key={p.id} value={p.id}>Subtopic of {p.title}</option>)}
          </select>
          <Button type="submit" disabled={pending}>Add</Button>
        </form>
      )}
    </div>
  );
}
