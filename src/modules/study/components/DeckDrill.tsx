"use client";

// Flashcard drill: flip, then "missed / almost / knew". Keyboard: Space or
// Enter flips; 1 or ← missed, 2 or ↓ almost, 3 or → knew. Missed cards come
// back once at the end of the drill. Each grade is saved (study.deck.review);
// time spent is logged as a study session when the drill ends.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { logStudySession, reviewStudyCard } from "@/modules/study/actions";
import type { ReviewGrade } from "@/modules/study/srs";

interface Card {
  id: string;
  front: string;
  back: string;
}

const GRADES: { grade: ReviewGrade; label: string; key: string; className: string }[] = [
  { grade: "missed", label: "Missed", key: "1", className: "border-destructive/40 hover:bg-destructive/10" },
  { grade: "almost", label: "Almost", key: "2", className: "border-amber-500/40 hover:bg-amber-500/10" },
  { grade: "knew", label: "Knew it", key: "3", className: "border-emerald-600/40 hover:bg-emerald-600/10" },
];

export function DeckDrill({ institutionSlug, deckId, subjectId, cards, queue: initialQueue, backHref }: {
  institutionSlug: string;
  deckId: string;
  subjectId: string | null;
  cards: Card[];
  queue: string[];
  backHref: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ knew: 0, almost: 0, missed: 0 });
  const requeued = useRef(new Set<string>());
  const startedAt = useRef<number | null>(null);
  const logged = useRef(false);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const card = byId.get(queue[pos] ?? "");
  const done = pos >= queue.length;

  const grade = useCallback(
    (g: ReviewGrade) => {
      if (!card || !flipped) return;
      void reviewStudyCard(institutionSlug, { materialId: deckId, cardId: card.id, grade: g }).then((res) => {
        if (!res.ok) toast.error(describeActionError(res.error));
      });
      setTally((t) => ({ ...t, [g]: t[g] + 1 }));
      if (g === "missed" && !requeued.current.has(card.id)) {
        requeued.current.add(card.id);
        setQueue((q) => [...q, card.id]);
      }
      setFlipped(false);
      setPos((p) => p + 1);
    },
    [card, flipped, institutionSlug, deckId],
  );

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select")) return;
      if (e.key === " " || e.key === "Enter") {
        // A focused button handles Space/Enter itself (native click).
        if (target?.closest("button")) return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "1" || e.key === "ArrowLeft") grade("missed");
      else if (e.key === "2" || e.key === "ArrowDown") grade("almost");
      else if (e.key === "3" || e.key === "ArrowRight") grade("knew");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grade]);

  useEffect(() => {
    if (!done || logged.current || pos === 0) return;
    logged.current = true;
    const minutes = Math.min(240, Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 60_000)));
    void logStudySession(institutionSlug, { activity: "flashcards", minutes, materialId: deckId, ...(subjectId ? { subjectId } : {}) }).then(() => router.refresh());
  }, [done, pos, institutionSlug, deckId, subjectId, router]);

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <p className="font-medium">Nothing due in this deck today</p>
        <p className="mt-1 text-sm text-muted-foreground">Come back when cards are due. Spacing reviews out is what makes them stick.</p>
        <Link href={backHref} className="mt-3 inline-flex min-h-10 items-center text-sm underline underline-offset-4">
          Back to decks
        </Link>
      </div>
    );
  }

  if (done || !card) {
    return (
      <div className="space-y-3 rounded-xl border p-5 text-center" role="status">
        <p className="text-lg font-semibold">Drill done</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          Knew {tally.knew} · Almost {tally.almost} · Missed {tally.missed}. Missed cards come back tomorrow.
        </p>
        <Link href={backHref} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
          Back to decks
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          Card {pos + 1} of {queue.length}
        </span>
        <span aria-hidden>Space flips · 1 2 3 grade</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${(pos / queue.length) * 100}%` }} />
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show the question side" : "Show the answer"}
        className="grid min-h-56 w-full place-items-center rounded-2xl border bg-card p-6 text-center shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-live="polite" className="space-y-2">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">{flipped ? "Answer" : "Question"}</span>
          <span className="block text-lg font-medium text-balance">{flipped ? card.back : card.front}</span>
          {!flipped && <span className="block text-xs text-muted-foreground">Tap or press Space to flip</span>}
        </span>
      </button>
      <div className="grid grid-cols-3 gap-2">
        {GRADES.map((g) => (
          <Button key={g.grade} variant="outline" disabled={!flipped} onClick={() => grade(g.grade)} className={`min-h-12 ${g.className}`}>
            {g.label}
            <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">({g.key})</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
