"use client";

// T-036 — "Generate quiz" trigger (06 §W6). Calls `POST /api/ai/quiz`
// directly from the client; that route persists nothing, so there is no
// server action to wrap this in. Saving is a separate step owned by
// `QuizReviewEditor`.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { QuizContent } from "@/modules/academics/assignments.schemas";

export interface QuizGenerateResult {
  content: QuizContent;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

type Difficulty = "easy" | "medium" | "hard";

interface QuizErrorBody {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

// 06 §W6 "Failure / retry" — these two texts are exact (fix round 1,
// security review LOW: `ai_unavailable` previously paraphrased the spec's
// wording); every other code shows the server's message, with the
// institution's AI policy appended for the policy/quota/rate codes (06 §W6:
// "shown with the policy name").
function errorMessage(body: QuizErrorBody, aiPolicy: string): string {
  switch (body.error.code) {
    case "ai_unavailable":
      return "Local AI engine is offline; retry or write the quiz manually";
    case "ai_invalid_output":
      return "Could not produce a valid quiz; try fewer questions";
    case "ai_policy_blocked":
    case "quota_exceeded":
    case "rate_limited":
      return `${body.error.message} (policy: ${aiPolicy})`;
    default:
      return body.error.message;
  }
}

interface QuizGenerateButtonProps {
  institutionSlug: string;
  curriculumUnitId: string;
  aiPolicy: string;
  onGenerated: (result: QuizGenerateResult) => void;
}

export function QuizGenerateButton({ institutionSlug, curriculumUnitId, aiPolicy, onGenerated }: QuizGenerateButtonProps) {
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institutionSlug, curriculumUnitId, questionCount, difficulty }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(errorMessage(body as QuizErrorBody, aiPolicy));
        return;
      }
      onGenerated(body.data as QuizGenerateResult);
    } catch {
      setError("Could not reach the server; check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium" htmlFor="questionCount">
            Questions
          </label>
          <Input
            id="questionCount"
            type="number"
            min={5}
            max={15}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="difficulty">
            Difficulty
          </label>
          <Select value={difficulty} onValueChange={(value) => setDifficulty(value as Difficulty)}>
            <SelectTrigger id="difficulty" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="button" onClick={handleGenerate} disabled={pending}>
        {pending ? "Generating…" : "Generate quiz"}
      </Button>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
