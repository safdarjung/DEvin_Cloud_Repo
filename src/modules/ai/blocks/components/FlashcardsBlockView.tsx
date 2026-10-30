"use client";

import { useState } from "react";
import type { FlashcardsBlock } from "@/modules/ai/blocks/schemas";

export function FlashcardsBlockView({ block }: { block: FlashcardsBlock }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  function toggle(index: number) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {block.cards.map((card, index) => {
        const isFlipped = flipped.has(index);
        return (
          <button
            key={index}
            type="button"
            onClick={() => toggle(index)}
            aria-pressed={isFlipped}
            className="min-h-24 rounded-lg border border-border p-3 text-left text-sm"
          >
            <p className="text-muted-foreground text-xs">{isFlipped ? "Answer" : "Question"} — tap to flip</p>
            <p className="mt-1">{isFlipped ? card.back : card.front}</p>
          </button>
        );
      })}
    </div>
  );
}
