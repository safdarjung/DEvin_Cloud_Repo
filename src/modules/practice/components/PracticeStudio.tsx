"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActionError } from "@/lib/action-error";
import type { ErrorCode } from "@/lib/actions/result";
import { submitPracticeAttempt } from "@/modules/practice/actions";
import type { PracticeQuestion } from "@/modules/practice/schemas";
import { scoreAttempt } from "@/modules/practice/scoring";

export interface StudioSubject {
  id: string;
  name: string;
  units: { id: string; title: string }[];
}

type Difficulty = "easy" | "medium" | "hard";
const COUNTS = [5, 10, 15] as const;
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
// Codes where the model path itself is down or refused: explain, never fake questions.
const AI_DOWN: ReadonlySet<ErrorCode> = new Set(["ai_unavailable", "ai_policy_blocked", "ai_invalid_output", "dependency_failed"]);

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ",
};

/** Model text writes powers as "2x^2" or "x^{n+1}": shown as "2x²", "xⁿ⁺¹". A power with no superscript form stays as typed. */
export function withSuperscripts(text: string): string {
  return text.replace(/\^(?:\{([^{}]{1,8})\}|(-?\d+|[nixy]))/g, (whole, braced: string | undefined, bare: string | undefined) => {
    const power = (braced ?? bare ?? "").replace(/\s+/g, "");
    return [...power].every((c) => c in SUPERSCRIPT) ? [...power].map((c) => SUPERSCRIPT[c]).join("") : whole;
  });
}

type Phase =
  | { kind: "setup" }
  | { kind: "generating" }
  | { kind: "unavailable"; code: ErrorCode }
  | { kind: "taking"; questions: PracticeQuestion[]; answers: (number | null)[]; model: string }
  | { kind: "result"; questions: PracticeQuestion[]; answers: (number | null)[]; score: number; maxScore: number };

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Choice({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-10 rounded-md border px-3 text-sm capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-foreground bg-foreground text-background" : "border-input hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

export function PracticeStudio({
  institutionSlug,
  studentId,
  subjects,
}: {
  institutionSlug: string;
  studentId: string;
  subjects: StudioSubject[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const withUnits = subjects.filter((s) => s.units.length > 0);
  const [subjectId, setSubjectId] = useState(withUnits[0]?.id ?? "");
  const [unitId, setUnitId] = useState(withUnits[0]?.units[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState<number>(5);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });

  const subject = withUnits.find((s) => s.id === subjectId);
  const subjectsHref = `/${institutionSlug}/portal/subjects?student=${studentId}`;
  const studyHref = `/${institutionSlug}/portal/study?student=${studentId}`;

  if (withUnits.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <p className="font-medium">No curriculum units to practise yet</p>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
          Practice quizzes are built from your subjects&apos; units. Ask your teacher to add units, or look through your subjects.
        </p>
        <Link href={subjectsHref} className="mt-3 inline-flex min-h-10 items-center text-sm underline underline-offset-4">
          Open subjects
        </Link>
      </div>
    );
  }

  async function generate(next?: Difficulty) {
    const level = next ?? difficulty;
    setDifficulty(level);
    setPhase({ kind: "generating" });
    try {
      const res = await fetch("/api/ai/practice-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionSlug, unitId, difficulty: level, count }),
      });
      const body = (await res.json()) as
        | { ok: true; data: { questions: PracticeQuestion[]; model: string } }
        | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> } };
      if (!body.ok) {
        if (AI_DOWN.has(body.error.code)) {
          setPhase({ kind: "unavailable", code: body.error.code });
        } else {
          toast.error(describeActionError(body.error));
          setPhase({ kind: "setup" });
        }
        return;
      }
      setPhase({ kind: "taking", questions: body.data.questions, answers: body.data.questions.map(() => null), model: body.data.model });
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
      setPhase({ kind: "setup" });
    }
  }

  function submit(questions: PracticeQuestion[], answers: (number | null)[]) {
    start(async () => {
      const res = await submitPracticeAttempt(institutionSlug, { studentId, curriculumUnitId: unitId, difficulty, questions, answers });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      setPhase({ kind: "result", questions, answers, score: res.data.score, maxScore: res.data.maxScore });
      router.refresh();
    });
  }

  if (phase.kind === "generating") {
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <span className="sr-only">Generating your quiz…</span>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (phase.kind === "unavailable") {
    return (
      <div role="alert" className="rounded-xl border px-4 py-6">
        <p className="font-medium">Practice quizzes are not available right now</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {phase.code === "ai_policy_blocked"
            ? "Your school's AI policy blocked this request, so no quiz was made."
            : "The quiz generator could not produce questions, so no quiz was made."}{" "}
          Nothing was saved. You can read the unit in your subjects or ask the study helper in your notebook.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={subjectsHref} className="inline-flex min-h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">
            Open subjects
          </Link>
          <Link href={studyHref} className="inline-flex min-h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">
            Open notebook
          </Link>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => setPhase({ kind: "setup" })}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "taking") {
    const { questions, answers } = phase;
    const answered = answers.filter((a) => a !== null).length;
    return (
      <FadeIn>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(questions, answers);
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground tabular-nums">
            {answered} of {questions.length} answered · {difficulty} · AI-generated, can contain mistakes
          </p>
          {questions.map((q, qi) => (
            <fieldset key={qi} className="rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">
                <span className="tabular-nums text-muted-foreground">{qi + 1}.</span> {withSuperscripts(q.stem)}
              </legend>
              <div className="mt-2 space-y-1">
                {q.options.map((opt, oi) => (
                  <label key={oi} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted has-[:checked]:bg-muted">
                    <input
                      type="radio"
                      name={`q-${qi}`}
                      className="mt-0.5 size-4 shrink-0 accent-foreground"
                      checked={answers[qi] === oi}
                      onChange={() => setPhase({ ...phase, answers: answers.map((a, i) => (i === qi ? oi : a)) })}
                    />
                    <span>{withSuperscripts(opt)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-10" disabled={pending}>
              {pending ? "Submitting…" : "Submit answers"}
            </Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => setPhase({ kind: "setup" })}>
              Discard
            </Button>
          </div>
          {answered < questions.length && <p className="text-xs text-muted-foreground">Unanswered questions score 0.</p>}
        </form>
      </FadeIn>
    );
  }

  if (phase.kind === "result") {
    const { questions, answers, score, maxScore } = phase;
    // Preview score only decides the Try harder suggestion; the saved score is the server's.
    const shown = scoreAttempt(questions, answers);
    const strong = maxScore > 0 && score / maxScore >= 0.8 && difficulty !== "hard";
    const harder: Difficulty = difficulty === "easy" ? "medium" : "hard";
    return (
      <FadeIn>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">Your score</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-[var(--chart-1)]">
              {score}/{maxScore}
            </p>
            {shown.score !== score && <p className="text-xs text-muted-foreground">The saved score is the one the server calculated.</p>}
          </div>
          <ol className="space-y-3">
            {questions.map((q, qi) => {
              const picked = answers[qi];
              const right = picked === q.answerIndex;
              return (
                <li key={qi} className="rounded-xl border p-4">
                  <p className="text-sm font-medium">
                    <span className="tabular-nums text-muted-foreground">{qi + 1}.</span> {withSuperscripts(q.stem)}
                  </p>
                  <p className={`mt-1 text-xs font-medium ${right ? "" : "text-destructive"}`}>{right ? "Correct" : picked === null ? "Skipped" : "Incorrect"}</p>
                  {!right && (
                    <div className="mt-2 space-y-1 text-sm">
                      {picked !== null && <p className="text-muted-foreground">Your answer: {withSuperscripts(q.options[picked] ?? "")}</p>}
                      <p>Correct answer: {withSuperscripts(q.options[q.answerIndex] ?? "")}</p>
                      {q.explanation && <p className="text-muted-foreground">{withSuperscripts(q.explanation)}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-10" onClick={() => void generate()}>
              Practice again
            </Button>
            {difficulty !== "hard" && (
              <Button type="button" variant={strong ? "default" : "outline"} className="min-h-10" onClick={() => void generate(harder)}>
                Try harder ({harder})
              </Button>
            )}
            <Button type="button" variant="outline" className="min-h-10" onClick={() => setPhase({ kind: "setup" })}>
              Change unit
            </Button>
          </div>
        </div>
      </FadeIn>
    );
  }

  return (
    <div className="grid max-w-xl gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="practice-subject" className="text-xs text-muted-foreground">
          Subject
        </label>
        <select
          id="practice-subject"
          className={selectClass}
          value={subjectId}
          onChange={(e) => {
            setSubjectId(e.target.value);
            setUnitId(withUnits.find((s) => s.id === e.target.value)?.units[0]?.id ?? "");
          }}
        >
          {withUnits.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="practice-unit" className="text-xs text-muted-foreground">
          Unit
        </label>
        <select id="practice-unit" className={selectClass} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {subject?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Difficulty</span>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTIES.map((d) => (
            <Choice key={d} label={d} selected={difficulty === d} onClick={() => setDifficulty(d)} />
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Questions</span>
        <div className="flex flex-wrap gap-2">
          {COUNTS.map((c) => (
            <Choice key={c} label={String(c)} selected={count === c} onClick={() => setCount(c)} />
          ))}
        </div>
      </div>
      <div>
        <Button type="button" className="min-h-10" disabled={!unitId} onClick={() => void generate()}>
          Generate quiz
        </Button>
      </div>
    </div>
  );
}
