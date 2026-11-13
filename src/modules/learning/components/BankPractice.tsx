"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { withSuperscripts } from "@/lib/superscript";
import { AnswerInput, isAnswered } from "@/modules/online-tests/components/AnswerInput";
import type { Answer } from "@/modules/online-tests/schemas";
import { startBankPractice, submitPracticeSession } from "@/modules/practice/actions";
import type { PracticeItem, PracticeSubmitResult } from "@/modules/practice/schemas";

export interface BankSubject {
  id: string;
  name: string;
  units: { id: string; title: string; available: number; topics: { id: string; title: string; available: number }[] }[];
}

type Difficulty = "any" | "easy" | "medium" | "hard";
const DIFFICULTIES: Difficulty[] = ["any", "easy", "medium", "hard"];
const COUNTS = [5, 10, 15] as const;
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Phase =
  | { kind: "setup" }
  | { kind: "taking"; sessionId: string; questions: PracticeItem[]; answers: (Answer | null)[]; resumed: boolean }
  | { kind: "result"; questions: PracticeItem[]; result: PracticeSubmitResult };

const show = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v));

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

export function BankPractice({
  institutionSlug,
  subjects,
  initialUnitId,
  initialTopicId,
}: {
  institutionSlug: string;
  subjects: BankSubject[];
  initialUnitId?: string;
  initialTopicId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const withBank = subjects.filter((s) => s.units.length > 0);
  const initialSubject = withBank.find((s) => s.units.some((u) => u.id === initialUnitId)) ?? withBank[0];
  const [subjectId, setSubjectId] = useState(initialSubject?.id ?? "");
  const [unitId, setUnitId] = useState(initialUnitId && initialSubject?.units.some((u) => u.id === initialUnitId) ? initialUnitId : (initialSubject?.units[0]?.id ?? ""));
  const [topicId, setTopicId] = useState<string | undefined>(initialTopicId);
  const [difficulty, setDifficulty] = useState<Difficulty>("any");
  const [count, setCount] = useState<number>(10);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [notice, setNotice] = useState<string | null>(null);

  if (withBank.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        Your teachers have not approved any school questions for your units yet. Try an AI quiz instead.
      </p>
    );
  }
  const subject = withBank.find((s) => s.id === subjectId);
  const unit = subject?.units.find((u) => u.id === unitId);

  function begin() {
    setNotice(null);
    start(async () => {
      const res = await startBankPractice(institutionSlug, { curriculumUnitId: unitId, topicId, difficulty: difficulty === "any" ? undefined : difficulty, count });
      if (!res.ok) {
        const msg = res.error.code === "rate_limited" ? "You have reached today's limit of 30 practice sets. Come back tomorrow." : describeActionError(res.error);
        setNotice(msg);
        toast.error(msg);
        return;
      }
      setPhase({ kind: "taking", sessionId: res.data.sessionId, questions: res.data.questions, answers: res.data.questions.map(() => null), resumed: res.data.resumed === true });
    });
  }

  function submit(sessionId: string, questions: PracticeItem[], answers: (Answer | null)[]) {
    start(async () => {
      const res = await submitPracticeSession(institutionSlug, { sessionId, answers });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      setPhase({ kind: "result", questions, result: res.data });
      router.refresh();
    });
  }

  if (phase.kind === "taking") {
    const { sessionId, questions, answers, resumed } = phase;
    const answered = answers.filter(isAnswered).length;
    return (
      <FadeIn>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(sessionId, questions, answers);
          }}
          className="space-y-4"
        >
          {resumed && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">You had an unfinished set for these settings, so it is back here. Your earlier answers were not saved.</p>}
          <p className="text-sm tabular-nums text-muted-foreground">{answered} of {questions.length} answered · school-approved questions · does not affect your marks</p>
          {questions.map((q, qi) => (
            <fieldset key={q.key} className="rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">
                <span className="tabular-nums text-muted-foreground">{qi + 1}.</span> {withSuperscripts(q.body)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">({q.marks} {q.marks === 1 ? "mark" : "marks"})</span>
              </legend>
              <div className="mt-2">
                <AnswerInput item={q} value={answers[qi] ?? null} onChange={(a) => setPhase({ ...phase, answers: answers.map((x, i) => (i === qi ? a : x)) })} />
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-10" disabled={pending}>{pending ? "Submitting…" : "Submit answers"}</Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => setPhase({ kind: "setup" })}>Leave for now</Button>
          </div>
          {answered < questions.length && <p className="text-xs text-muted-foreground">Unanswered questions score 0.</p>}
        </form>
      </FadeIn>
    );
  }

  if (phase.kind === "result") {
    const { questions, result } = phase;
    return (
      <FadeIn>
        <div className="space-y-4" data-testid="bank-result">
          <div>
            <p className="text-xs text-muted-foreground">Your practice score (not your marks)</p>
            <p className="text-3xl font-semibold tabular-nums text-[var(--chart-1)]">{result.score}/{result.maxScore}</p>
          </div>
          <ol className="space-y-3">
            {questions.map((q, qi) => {
              const r = result.results.find((x) => x.key === q.key) ?? result.results[qi];
              const skipped = r?.given === null || r?.given === undefined;
              return (
                <li key={q.key} className="rounded-xl border p-4">
                  <p className="text-sm font-medium"><span className="tabular-nums text-muted-foreground">{qi + 1}.</span> {withSuperscripts(q.body)}</p>
                  <p className={`mt-1 text-xs font-medium ${r?.correct ? "" : "text-destructive"}`}>
                    {r?.correct ? "Correct" : skipped ? "Skipped" : r && r.awarded > 0 ? "Partly correct" : "Incorrect"} · {r?.awarded ?? 0}/{r?.marks ?? q.marks}
                  </p>
                  {!r?.correct && (
                    <div className="mt-2 space-y-1 text-sm">
                      {!skipped && <p className="text-muted-foreground">Your answer: {withSuperscripts(show(r?.given))}</p>}
                      {r?.answer && <p>Correct answer: {withSuperscripts(r.answer)}</p>}
                    </div>
                  )}
                  {r?.explanation && <p className="mt-1 text-sm text-muted-foreground">{withSuperscripts(r.explanation)}</p>}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-10" disabled={pending} onClick={begin}>Practice again</Button>
            <Button type="button" variant="outline" className="min-h-10" onClick={() => setPhase({ kind: "setup" })}>Change settings</Button>
          </div>
        </div>
      </FadeIn>
    );
  }

  return (
    <div className="grid max-w-xl gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="bank-subject" className="text-xs text-muted-foreground">Subject</label>
        <select id="bank-subject" className={selectClass} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setUnitId(withBank.find((s) => s.id === e.target.value)?.units[0]?.id ?? ""); setTopicId(undefined); }}>
          {withBank.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="bank-unit" className="text-xs text-muted-foreground">Chapter</label>
        <select id="bank-unit" className={selectClass} value={unitId} onChange={(e) => { setUnitId(e.target.value); setTopicId(undefined); }}>
          {subject?.units.map((u) => <option key={u.id} value={u.id}>{u.title} ({u.available} {u.available === 1 ? "question" : "questions"})</option>)}
        </select>
      </div>
      {(Boolean(unit?.topics.length) || Boolean(topicId)) && (
        <div className="grid gap-1.5">
          <label htmlFor="bank-topic" className="text-xs text-muted-foreground">Topic</label>
          <select id="bank-topic" className={selectClass} value={topicId ?? ""} onChange={(e) => setTopicId(e.target.value || undefined)}>
            <option value="">Whole chapter</option>
            {/* A weak topic from "Where to focus" may hold its questions in subtopics, so it is not always in the list. */}
            {topicId && !unit?.topics.some((t) => t.id === topicId) && <option value={topicId}>Your weak topic</option>}
            {unit?.topics.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.available} {t.available === 1 ? "question" : "questions"})</option>)}
          </select>
        </div>
      )}
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Difficulty</span>
        <div className="flex flex-wrap gap-2">{DIFFICULTIES.map((d) => <Choice key={d} label={d} selected={difficulty === d} onClick={() => setDifficulty(d)} />)}</div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Questions</span>
        <div className="flex flex-wrap gap-2">{COUNTS.map((c) => <Choice key={c} label={String(c)} selected={count === c} onClick={() => setCount(c)} />)}</div>
      </div>
      {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
      <div>
        <Button type="button" className="min-h-10" disabled={!unit || pending} onClick={begin}>{pending ? "Starting…" : "Start practice"}</Button>
      </div>
    </div>
  );
}
