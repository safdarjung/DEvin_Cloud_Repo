"use client";

// GU-09 — the notebook's list rows: pin/delete act immediately (own-rows
// RLS is the real backstop, same as every other write here); rename/move
// are left to a later pass — this is the smallest set that makes the list
// genuinely usable (find it again via pin, remove it via delete).
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
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
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
      <Link href={href} className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="text-muted-foreground text-xs">
          {item.kind === "chat" ? "Chat" : "Note"}
          {item.folder ? ` · ${item.folder}` : ""}
        </p>
      </Link>
      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={togglePin} disabled={busy} aria-pressed={item.pinned}>
          {item.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function NotebookList({ institutionSlug, items }: NotebookListProps) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing saved yet.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <NotebookRow key={item.id} institutionSlug={institutionSlug} item={item} />
      ))}
    </div>
  );
}
