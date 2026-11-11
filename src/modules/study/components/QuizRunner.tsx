"use client";

// Studio quiz: one question at a time, optional timer. Answers and the timer
// live in localStorage, so a refresh resumes where the student was. Keyboard:
// 1-4 pick an option (1 = True, 2 = False), ← → move between questions.
// MCQ and true/false are marked automatically; short answers go to the AI
// check and are labelled AI-checked practice. Nothing here is a mark.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { submitStudyQuiz } from "@/modules/study/actions";
import type { Difficulty, QuizQuestion } from "@/modules/study/formats";
import type { QuizAnswer, Verdict } from "@/modules/study/quiz";

interface Saved {
  answers: QuizAnswer[];
  startedAt: number;
  deadline: number | null;
  index: number;
}
interface Result {
  answers: QuizAnswer[];
  verdicts: Verdict[];
  autoScore: number;
  autoMax: number;
  aiPoints: number;
  aiMax: number;
  checks: ({ score: number; feedback: string } | null)[];
  aiChecked: boolean;
}

const TIMERS = [0, 5, 10, 15, 20, 30];
const letter = (i: number) => String.fromCharCode(65 + i);

// In-progress quiz state lives in localStorage (survives a refresh); memory is the fallback when storage is blocked.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function QuizRunner({ institutionSlug, materialId, title, subjectId, unitId, difficulty, questions, backHref }: {
  institutionSlug: string;
  materialId: string;
  title: string;
  subjectId: string | null;
  unitId: string | null;
  difficulty: Difficulty;
  questions: QuizQuestion[];
  backHref: string;
}) {
  const router = useRouter();
  const key = `study-quiz:${materialId}`;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const state = useMemo((): Saved | null => {
    try {
      const saved = raw ? (JSON.parse(raw) as Saved) : null;
      return saved && saved.answers.length === questions.length ? saved : null;
    } catch {
      return null;
    }
  }, [raw, questions.length]);
  const [timer, setTimer] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const submittedRef = useRef(false);
  const update = useCallback((next: Saved) => write(key, JSON.stringify(next)), [key]);

  const submit = useCallback(async () => {
    if (!state || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    const shortIdx = questions.map((q, i) => (q.type === "short" ? i : -1)).filter((i) => i >= 0);
    const answered = shortIdx.filter((i) => typeof state.answers[i] === "string" && (state.answers[i] as string).trim());
    let checks: ({ score: number; feedback: string } | null)[] = shortIdx.map(() => null);
    let aiChecked = shortIdx.length === 0;
    if (answered.length) {
      try {
        const res = await fetch("/api/ai/study-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionSlug,
            items: answered.map((i) => {
              const q = questions[i] as Extract<QuizQuestion, { type: "short" }>;
              return { stem: q.stem, modelAnswer: q.modelAnswer, rubric: q.rubric, answer: String(state.answers[i]).slice(0, 1000) };
            }),
          }),
        });
        const body = (await res.json()) as { ok: true; data: { results: { score: number; feedback: string }[] } } | { ok: false; error: { message: string } };
        if (body.ok) {
          checks = shortIdx.map((i) => (answered.includes(i) ? body.data.results[answered.indexOf(i)]! : { score: 0, feedback: "Not answered." }));
          aiChecked = true;
        } else {
          toast.error(`Short answers could not be checked: ${body.error.message}`);
        }
      } catch {
        toast.error("Short answers could not be checked. Your other answers are still marked.");
      }
    } else if (shortIdx.length) {
      checks = shortIdx.map(() => ({ score: 0, feedback: "Not answered." }));
      aiChecked = true;
    }

    const saved = await submitStudyQuiz(institutionSlug, {
      materialId,
      title,
      difficulty,
      questions,
      answers: state.answers,
      aiChecks: aiChecked ? (checks as { score: number; feedback: string }[]) : [],
      durationSeconds: Math.min(14_400, Math.round((Date.now() - state.startedAt) / 1000)),
      ...(subjectId ? { subjectId } : {}),
      ...(unitId ? { unitId } : {}),
    });
    setBusy(false);
    if (!saved.ok) {
      submittedRef.current = false;
      toast.error(describeActionError(saved.error));
      return;
    }
    setResult({ ...saved.data, answers: state.answers, checks: questions.map((q, i) => (q.type === "short" ? checks[shortIdx.indexOf(i)] ?? null : null)), aiChecked });
    write(key, null);
    router.refresh();
  }, [state, questions, institutionSlug, materialId, title, difficulty, subjectId, unitId, key, router]);

  // Timer: tick every second while a deadline is set; time up submits once (also after a refresh past the deadline).
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  const deadline = state?.deadline ?? null;
  useEffect(() => {
    if (!deadline || result) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) void submitRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline, result]);

  const setAnswer = useCallback(
    (value: QuizAnswer) => {
      if (!state) return;
      update({ ...state, answers: state.answers.map((a, i) => (i === state.index ? value : a)) });
    },
    [state, update],
  );

  useEffect(() => {
    if (!state || result) return;
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select")) return;
      const q = questions[state.index]!;
      if (e.key === "ArrowRight" && state.index < questions.length - 1) update({ ...state, index: state.index + 1 });
      else if (e.key === "ArrowLeft" && state.index > 0) update({ ...state, index: state.index - 1 });
      else if (q.type === "mcq" && ["1", "2", "3", "4"].includes(e.key)) setAnswer(Number(e.key) - 1);
      else if (q.type === "true_false" && (e.key === "1" || e.key.toLowerCase() === "t")) setAnswer(true);
      else if (q.type === "true_false" && (e.key === "2" || e.key.toLowerCase() === "f")) setAnswer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, result, questions, update, setAnswer]);

  if (result) {
    return (
      <section aria-labelledby="quiz-result" className="space-y-4">
        <div className="rounded-xl border p-4">
          <h3 id="quiz-result" className="text-lg font-semibold">
            Practice result
          </h3>
          <p className="mt-1 text-sm tabular-nums">
            Auto-marked: {result.autoScore}/{result.autoMax}
            {result.aiMax > 0 && (
              <>
                {" "}· AI-checked short answers: {result.aiPoints}/{result.aiMax} points
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Practice only. This never goes into your marks or report card.</p>
          {!result.aiChecked && <p className="mt-1 text-xs text-muted-foreground">Short answers were not checked this time, so they are not scored.</p>}
        </div>
        <ol className="space-y-3">
          {questions.map((q, i) => {
            const a = result.answers[i] ?? null;
            const check = result.checks[i];
            const verdict = result.verdicts[i];
            return (
              <li key={i} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {i + 1}. {q.stem}
                </p>
                <p className="mt-1">
                  {verdict === "correct" && <Badge className="bg-emerald-600 text-white">Correct</Badge>}
                  {verdict === "incorrect" && <Badge variant="destructive">Not quite</Badge>}
                  {verdict === "unanswered" && <Badge variant="secondary">Skipped</Badge>}
                  {verdict === "ai_check" && check && (
                    <Badge variant="secondary">AI-checked practice: {check.score}/2</Badge>
                  )}
                </p>
                {q.type === "mcq" && (
                  <p className="mt-1 text-muted-foreground">
                    {a !== null ? `Your answer: ${letter(a as number)}. ${q.options[a as number]}. ` : ""}Answer: {letter(q.answerIndex)}. {q.options[q.answerIndex]}
                  </p>
                )}
                {q.type === "true_false" && (
                  <p className="mt-1 text-muted-foreground">
                    {a !== null ? `Your answer: ${a ? "True" : "False"}. ` : ""}Answer: {q.answer ? "True" : "False"}
                  </p>
                )}
                {q.type === "short" && (
                  <>
                    {typeof a === "string" && a && <p className="mt-1 text-muted-foreground">Your answer: {a}</p>}
                    {check && <p className="mt-1">AI feedback (practice): {check.feedback}</p>}
                    <p className="mt-1 text-muted-foreground">Model answer: {q.modelAnswer}</p>
                  </>
                )}
                {q.explanation && <p className="mt-1 text-xs text-muted-foreground">{q.explanation}</p>}
              </li>
            );
          })}
        </ol>
        <Link href={backHref} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
          Back to quizzes
        </Link>
      </section>
    );
  }

  if (!state) {
    return (
      <div className="space-y-4 rounded-xl border p-4">
        <p className="text-sm">
          {questions.length} questions · {difficulty}. Multiple choice and true/false are marked straight away; short answers are AI-checked practice.
        </p>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-2 text-sm font-medium">Timer</legend>
          {TIMERS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={timer === m}
              onClick={() => setTimer(m)}
              className={`min-h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${timer === m ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"}`}
            >
              {m === 0 ? "No timer" : `${m} min`}
            </button>
          ))}
        </fieldset>
        <Button
          size="lg"
          onClick={() => {
            const startedAt = Date.now();
            update({ answers: questions.map(() => null), startedAt, deadline: timer ? startedAt + timer * 60_000 : null, index: 0 });
          }}
        >
          Start quiz
        </Button>
      </div>
    );
  }

  const q = questions[state.index]!;
  const answer = state.answers[state.index] ?? null;
  const remaining = state.deadline ? Math.max(0, state.deadline - now) : null;
  const answeredCount = state.answers.filter((a) => a !== null && a !== "").length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm tabular-nums">
        <span className="text-muted-foreground">
          Question {state.index + 1} of {questions.length} · {answeredCount} answered
        </span>
        {remaining !== null && (
          <span role="timer" aria-live="off" className={`rounded-md px-2 py-0.5 font-medium ${remaining < 60_000 ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
            {Math.floor(remaining / 60_000)}:{String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <p className="text-base font-medium" id="quiz-stem">
          {q.stem}
        </p>
        <div className="mt-4 grid gap-2" role={q.type === "short" ? undefined : "radiogroup"} aria-labelledby="quiz-stem">
          {q.type === "mcq" &&
            q.options.map((o, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={answer === i}
                onClick={() => setAnswer(i)}
                className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${answer === i ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md border text-xs font-semibold">{i + 1}</span>
                {o}
              </button>
            ))}
          {q.type === "true_false" &&
            [true, false].map((v, i) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={answer === v}
                onClick={() => setAnswer(v)}
                className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${answer === v ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md border text-xs font-semibold">{i + 1}</span>
                {v ? "True" : "False"}
              </button>
            ))}
          {q.type === "short" && (
            <label className="block text-sm">
              <span className="text-muted-foreground">Your answer (AI-checked practice)</span>
              <textarea
                value={typeof answer === "string" ? answer : ""}
                maxLength={1000}
                rows={4}
                onChange={(e) => setAnswer(e.target.value ? e.target.value : null)}
                className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" disabled={state.index === 0} onClick={() => update({ ...state, index: state.index - 1 })}>
            Previous
          </Button>
          <Button variant="outline" disabled={state.index === questions.length - 1} onClick={() => update({ ...state, index: state.index + 1 })}>
            Next
          </Button>
        </div>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? "Marking…" : "Finish and mark"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" aria-hidden>
        Keys: 1–4 choose · ← → move
      </p>
    </div>
  );
}
