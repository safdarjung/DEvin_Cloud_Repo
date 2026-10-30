"use client";

import { useState } from "react";
import type { PracticeBlock } from "@/modules/ai/blocks/schemas";

export function PracticeBlockView({ block }: { block: PracticeBlock }) {
  // Keyed/compared by index, not option text: the schema's uniqueness
  // check (schemas.ts) makes duplicate option text impossible today, but
  // index comparison removes the failure mode entirely rather than
  // depending on that check never regressing.
  const [selected, setSelected] = useState<Record<number, number>>({});

  return (
    <div className="space-y-4">
      {/* Plan §8 honesty label — practice is never graded or shown to a teacher. */}
      <p className="text-muted-foreground text-xs italic">Practice only — not graded, not sent to your teacher.</p>
      <ol className="space-y-4">
        {block.questions.map((question, questionIndex) => {
          const pickedIndex = selected[questionIndex];
          const answerIndex = question.options.indexOf(question.answer);
          return (
            <li key={questionIndex} className="rounded-lg border border-border p-3">
              <p className="font-medium">
                {questionIndex + 1}. {question.stem}
              </p>
              <ul className="mt-2 space-y-1 pl-4">
                {question.options.map((option, optionIndex) => {
                  const isPicked = optionIndex === pickedIndex;
                  const isCorrect = pickedIndex !== undefined && optionIndex === answerIndex;
                  return (
                    <li key={optionIndex}>
                      <button
                        type="button"
                        onClick={() => setSelected((prev) => ({ ...prev, [questionIndex]: optionIndex }))}
                        className={
                          isCorrect
                            ? "font-semibold text-primary"
                            : isPicked
                              ? "text-destructive"
                              : "text-foreground"
                        }
                      >
                        {option}
                        {isCorrect ? " (correct)" : isPicked ? " (not quite)" : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pickedIndex !== undefined && question.explanation && (
                <p className="text-muted-foreground mt-2 text-sm">{question.explanation}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
