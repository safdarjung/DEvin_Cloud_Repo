"use client";

// Recent chats and saved notes, from the orb itself (owner, 2026-11-12). Chats save as they happen;
// a note is anything the person saved with the bookmark button. Pinned items come first.
import { useState } from "react";
import { Bookmark, BookmarkCheck, History, Loader2, MessageSquare, Pin, PinOff, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { callAction } from "@/modules/ai/components/task-card/api";

interface Item {
  id: string;
  kind: "chat" | "note";
  title: string;
  pinned: boolean;
  updatedAt: string;
}
export interface OpenedChat {
  id: string;
  title: string;
  messages: unknown[];
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function OrbHistory({ institutionSlug, onOpenChat, compact }: { institutionSlug: string; onOpenChat: (chat: OpenedChat) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await callAction<Item[]>(institutionSlug, "ai.orb.items.list", {});
    if (res.ok) setItems(res.data);
    else setError(res.error.message);
  }
  async function openItem(item: Item) {
    setBusy(item.id);
    const res = await callAction<{ id: string; kind: string; title: string; messages: unknown[]; text: string }>(institutionSlug, "ai.orb.item.get", { itemId: item.id });
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    if (res.data.kind === "chat") {
      onOpenChat({ id: res.data.id, title: res.data.title, messages: res.data.messages });
      setOpen(false);
    } else setNote({ title: res.data.title, text: res.data.text });
  }
  async function pin(item: Item) {
    const res = await callAction(institutionSlug, "ai.orb.item.pin", { itemId: item.id, pinned: !item.pinned });
    if (res.ok) void load();
  }
  async function remove(item: Item) {
    const res = await callAction(institutionSlug, "ai.orb.item.delete", { itemId: item.id });
    if (res.ok) setItems((xs) => xs?.filter((x) => x.id !== item.id) ?? null);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) void load();
        }}
      >
        <PopoverTrigger asChild>
          {compact ? (
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Recent chats and saved notes" title="Recent chats and saved notes">
              <History />
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="rounded-full">
              <History className="size-3.5" aria-hidden /> Recent chats
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] gap-1 p-2">
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Recent chats and saved notes</p>
          {error && <p className="px-1 py-2 text-sm text-destructive">{error}</p>}
          {items === null && !error && (
            <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          )}
          {items?.length === 0 && <p className="px-1 py-3 text-sm text-muted-foreground">Your chats appear here as you talk to the orb. Save any answer with the bookmark button.</p>}
          <ul className="max-h-80 space-y-0.5 overflow-y-auto">
            {items?.map((item) => (
              <li key={item.id} className="group flex items-center gap-1 rounded-lg hover:bg-accent">
                <button type="button" onClick={() => void openItem(item)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {busy === item.id ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : item.kind === "chat" ? <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <StickyNote className="size-4 shrink-0 text-amber-600" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{when(item.updatedAt)}</span>
                </button>
                <button type="button" onClick={() => void pin(item)} aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {item.pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
                </button>
                <button type="button" onClick={() => void remove(item)} aria-label={`Delete ${item.title}`} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Dialog open={note !== null} onOpenChange={(o) => !o && setNote(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{note?.title}</DialogTitle>
          <DialogDescription className="sr-only">A note saved from the orb</DialogDescription>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{note?.text}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Saves an answer or a card as a note; the bookmark fills once it is saved. */
export function SaveNoteButton({ institutionSlug, title, text }: { institutionSlug: string; title: string; text: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  return (
    <button
      type="button"
      disabled={state === "saving" || state === "saved" || !text.trim()}
      onClick={async () => {
        setState("saving");
        const res = await callAction(institutionSlug, "ai.orb.note.save", { title: title.trim().slice(0, 120) || "Saved from the orb", text: text.slice(0, 12000) });
        setState(res.ok ? "saved" : "failed");
      }}
      aria-label={state === "saved" ? "Saved to your notes" : state === "failed" ? "Could not save. Try again" : "Save to your notes"}
      title={state === "saved" ? "Saved" : state === "failed" ? "Could not save, try again" : "Save"}
      className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 pointer-coarse:size-11"
    >
      {state === "saving" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : state === "saved" ? <BookmarkCheck className="size-3.5 text-primary" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
    </button>
  );
}
