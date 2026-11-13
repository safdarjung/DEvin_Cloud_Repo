"use client";

import { useState } from "react";
import { PracticeStudio, type StudioSubject } from "@/modules/practice/components/PracticeStudio";
import { BankPractice, type BankSubject } from "./BankPractice";

type Mode = "bank" | "ai";

/** School question bank (default) and AI quiz, one switch. */
export function PracticeHub({
  institutionSlug,
  studentId,
  bankSubjects,
  aiSubjects,
  initialMode,
  initialUnitId,
  initialTopicId,
}: {
  institutionSlug: string;
  studentId: string;
  bankSubjects: BankSubject[];
  aiSubjects: StudioSubject[];
  initialMode: Mode;
  initialUnitId?: string;
  initialTopicId?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const tabs: [Mode, string][] = [["bank", "School questions"], ["ai", "AI quiz"]];
  return (
    <div id="practice" className="scroll-mt-20 space-y-4">
      <div role="group" aria-label="Practice source" className="flex gap-2">
        {tabs.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-10 rounded-md border px-3 text-sm ${mode === m ? "border-foreground bg-foreground text-background" : "border-input hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "bank" ? (
        <BankPractice institutionSlug={institutionSlug} subjects={bankSubjects} initialUnitId={initialUnitId} initialTopicId={initialTopicId} />
      ) : (
        <PracticeStudio institutionSlug={institutionSlug} studentId={studentId} subjects={aiSubjects} initialUnitId={initialUnitId} />
      )}
    </div>
  );
}
