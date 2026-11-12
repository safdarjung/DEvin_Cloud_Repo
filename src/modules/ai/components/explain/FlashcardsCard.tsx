"use client";

// A deck from /flashcards: one card at a time, tap (or Space) to flip, arrows to move, shuffle, and
// "Got it" / "Again" so the missed ones come round again. Practice only: nothing is saved.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Layers, RotateCcw, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import type { AiMeta, Flashcards } from "@/modules/ai/explain/schemas";

export type FlashcardsResult = { flashcards: Flashcards } & AiMeta;

const shuffled = <T,>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

export function FlashcardsCard({ result, fromFile }: { result: FlashcardsResult; fromFile?: boolean }) {
  const all = result.flashcards.cards;
  const [queue, setQueue] = useState<number[]>(() => all.map((_, i) => i));
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(() => new Set());
  const card = all[queue[at] ?? 0]!;
  const done = at >= queue.length;
  const progress = useMemo(() => `${known.size} of ${all.length} known`, [known, all.length]);

  const go = (n: number) => {
    setFlipped(false);
    setAt(Math.max(0, Math.min(queue.length, n)));
  };
  const answer = (gotIt: boolean) => {
    const i = queue[at]!;
    if (gotIt) setKnown((k) => new Set(k).add(i));
    else setQueue((q) => [...q, i]); // a missed card comes round again at the end
    go(at + 1);
  };
  const restart = (order: number[]) => {
    setQueue(order);
    setKnown(new Set());
    setAt(0);
    setFlipped(false);
  };

  return (
    <section aria-label={`Flashcards: ${result.flashcards.title}`} className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{result.flashcards.title}</span>
        </p>
        {fromFile ? <Badge variant="secondary">Read from your file (cloud)</Badge> : <ProviderBadge provider={result.provider} />}
      </div>

      {done ? (
        <div className="grid min-h-40 place-items-center rounded-xl border border-dashed p-4 text-center text-sm">
          <div className="space-y-3">
            <p className="font-medium">{known.size === all.length ? "You know all of them." : `Round finished: ${progress}.`}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => restart(all.map((_, i) => i))}>
                <RotateCcw className="size-3.5" aria-hidden /> Start again
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => restart(shuffled(all.map((_, i) => i)))}>
                <Shuffle className="size-3.5" aria-hidden /> Shuffle
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Showing the answer. Tap to see the question" : "Showing the question. Tap to see the answer"}
            className="grid min-h-40 w-full place-items-center rounded-xl border bg-background p-5 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="space-y-2">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{flipped ? "Answer" : "Question"}</span>
              <span className={`block whitespace-pre-wrap ${flipped ? "text-sm" : "text-base font-medium"}`}>{flipped ? card.back : card.front}</span>
            </span>
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" aria-label="Previous card" disabled={at === 0} onClick={() => go(at - 1)}>
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {at + 1} / {queue.length} · {progress}
              </span>
              <Button type="button" size="icon" variant="ghost" aria-label="Next card" onClick={() => go(at + 1)}>
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
            {flipped ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => answer(false)}>
                  Again
                </Button>
                <Button type="button" size="sm" onClick={() => answer(true)}>
                  Got it
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setFlipped(true)}>
                Show answer
              </Button>
            )}
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">{fromFile ? "Made from your file by AI." : "Made by AI from general knowledge."} Check facts before you rely on them. Practice only, nothing is saved. For decks you keep, use Study studio.</p>
    </section>
  );
}
