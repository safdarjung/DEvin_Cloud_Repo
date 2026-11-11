"use client";

// Studio quiz: one question at a time, optional timer. Answers and the timer
// live in localStorage, so a refresh resumes where the student was. Keyboard:
// 1-4 pick an option (1 = True, 2 = False), ← → move between questions.
// MCQ and true/false are marked automatically; short answers go to the AI
// check and are labelled AI-checked practice. Nothing here is a mark.
// 0140: a mock exam runs here too, timed to the paper's duration, and its
// result adds a per-section and per-unit breakdown with what to revise.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { submitStudyQuiz } from "@/modules/study/actions";
import type { Difficulty, MockContent, QuizQuestion } from "@/modules/study/formats";
import { mockBreakdown } from "@/modules/study/mock";
import { AskTeacher } from "./AskTeacher";
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

export function QuizRunner({ institutionSlug, materialId, title, subjectId, unitId, difficulty, questions, backHref, mock, canAsk }: {
  institutionSlug: string;
  materialId: string;
  title: string;
  subjectId: string | null;
  unitId: string | null;
  difficulty: Difficulty;
  questions: QuizQuestion[];
  backHref: string;
  /** 0140: a mock exam paper (fixed timer, breakdown on the result). */
  mock?: MockContent;
  /** 0140: show "Ask my teacher" on each reviewed question (needs a subject). */
  canAsk?: boolean;
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
  const [timer, setTimer] = useState(mock?.durationMinutes ?? 0);
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
        {mock && <MockResult mock={mock} verdicts={result.verdicts} checks={result.aiChecked ? result.checks.filter((c): c is { score: number; feedback: string } => c !== null) : []} />}
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
                {canAsk && subjectId && (
                  <AskTeacher institutionSlug={institutionSlug} subjectId={subjectId} contextKind="quiz_question" materialId={materialId} excerpt={q.stem} compact />
                )}
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
        {mock ? (
          <p className="text-sm font-medium tabular-nums">Timed: {mock.durationMinutes} minutes{mock.examLabel ? ` (as the real paper: ${mock.examLabel})` : ""}. Practice only, never a mark.</p>
        ) : (
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
        )}
        <Button
          size="lg"
          onClick={() => {
            const startedAt = Date.now();
            update({ answers: questions.map(() => null), startedAt, deadline: timer ? startedAt + timer * 60_000 : null, index: 0 });
          }}
        >
          {mock ? "Start mock exam" : "Start quiz"}
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

function MockResult({ mock, verdicts, checks }: { mock: MockContent; verdicts: Verdict[]; checks: { score: number }[] }) {
  const r = mockBreakdown(mock, verdicts, checks);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section aria-labelledby="mock-sections" className="rounded-xl border p-4">
        <h4 id="mock-sections" className="text-sm font-semibold">By section</h4>
        <ul className="mt-2 space-y-1 text-sm tabular-nums">
          {r.sections.map((s) => (
            <li key={s.type} className="flex justify-between gap-2">
              <span>{s.label}</span>
              <span>
                {s.correct}/{s.total}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="mock-units" className="rounded-xl border p-4">
        <h4 id="mock-units" className="text-sm font-semibold">By unit</h4>
        <ul className="mt-2 space-y-1 text-sm tabular-nums">
          {r.units.map((u) => (
            <li key={u.unitId} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{u.title}</span>
              <span className="shrink-0">{u.percent}%</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="mock-revise" className="rounded-xl border p-4 sm:col-span-2">
        <h4 id="mock-revise" className="text-sm font-semibold">What to revise</h4>
        {r.revise.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No unit under 60% this time. Keep practising with flashcards.</p>
        ) : (
          <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-sm">
            {r.revise.map((u) => (
              <li key={u.unitId}>
                {u.title} <span className="text-muted-foreground tabular-nums">({u.percent}%)</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Mock exam: practice only. It never goes into your marks or report card.</p>
      </section>
    </div>
  );
}
