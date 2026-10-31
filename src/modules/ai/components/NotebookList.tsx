"use client";

// GU-09 — the notebook's list rows: pin/delete act immediately (own-rows
// RLS is the real backstop, same as every other write here); rename/move
// are left to a later pass — this is the smallest set that makes the list
// genuinely usable (find it again via pin, remove it via delete).
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteStudyItem, updateStudyItem } from "@/modules/ai/student-study.actions";
import type { StudyItemSummary } from "@/modules/ai/student-study.queries";

interface NotebookListProps {
  institutionSlug: string;
  items: StudyItemSummary[];
}

function NotebookRow({ institutionSlug, item }: { institutionSlug: string; item: StudyItemSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const href = item.kind === "chat" ? `/${institutionSlug}/portal/study?resume=${item.id}` : `/${institutionSlug}/portal/study/notebook/${item.id}`;

  async function togglePin() {
    setBusy(true);
    await updateStudyItem(institutionSlug, { itemId: item.id, pinned: !item.pinned });
    setBusy(false);
    router.refresh();
  }

  async function handleDelete() {
    setBusy(true);
    await deleteStudyItem(institutionSlug, { itemId: item.id });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
      <Link href={href} className="min-h-10 min-w-0 flex-1 basis-40">
        <p className="truncate font-medium">{item.title}</p>
        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={item.kind === "chat" ? "info" : "outline"}>{item.kind === "chat" ? "Chat" : "Note"}</Badge>
          {item.folder ? <span>{item.folder}</span> : null}
        </p>
      </Link>
      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={togglePin} disabled={busy} aria-pressed={item.pinned}>
          {item.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={handleDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function NotebookList({ institutionSlug, items }: NotebookListProps) {
  if (items.length === 0) {
    return <EmptyState title="Nothing saved yet" description="Save a chat or make notes from the study helper and they will appear here." />;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <NotebookRow key={item.id} institutionSlug={institutionSlug} item={item} />
      ))}
    </div>
  );
}
