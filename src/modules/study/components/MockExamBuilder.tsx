"use client";

// Mock exam builder (0140): a real upcoming paper of the student's section
// (its units and duration come from the school's paper on the server) or a
// subject + chosen units. Draft first; "Keep and start" saves it and opens it
// in the quiz runner with the paper's timer. Practice only.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActionError } from "@/lib/action-error";
import { DIFFICULTIES, type Difficulty, type MockContent } from "@/modules/study/formats";
import { saveMockExam } from "@/modules/study/help.actions";
import { MOCK_DURATIONS, MOCK_LENGTHS, MOCK_MAX_UNITS, SECTION_LABELS, type MockLength } from "@/modules/study/mock";

interface Draft {
  title: string;
  subjectId: string | null;
  content: MockContent;
  focusUnitIds: string[];
}

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MockExamBuilder({
  institutionSlug,
  papers,
  subjects,
}: {
  institutionSlug: string;
  papers: { paperId: string; label: string; date: string; durationMinutes: number | null }[];
  subjects: { id: string; name: string; units: { id: string; title: string }[] }[];
}) {
  const router = useRouter();
  const withUnits = subjects.filter((s) => s.units.length > 0);
  const [mode, setMode] = useState<"paper" | "units">(papers.length ? "paper" : "units");
  const [paperId, setPaperId] = useState(papers[0]?.paperId ?? "");
  const [subjectId, setSubjectId] = useState(withUnits[0]?.id ?? "");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<(typeof MOCK_DURATIONS)[number]>(30);
  const [count, setCount] = useState<MockLength>(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, start] = useTransition();
  const subject = withUnits.find((s) => s.id === subjectId);

  async function build() {
    setBusy(true);
    try {
      const scope = mode === "paper" ? { kind: "paper", paperId } : { kind: "units", subjectId, unitIds, durationMinutes: duration };
      const res = await fetch("/api/ai/study-mock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ institutionSlug, scope, count, difficulty }) });
      const body = (await res.json()) as { ok: true; data: Draft } | { ok: false; error: { message: string } };
      if (!body.ok) {
        toast.error(`${body.error.message} Nothing was saved.`);
        return;
      }
      setDraft(body.data);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    const sections = new Map<string, number>();
    for (const q of draft.content.questions) sections.set(SECTION_LABELS[q.type], (sections.get(SECTION_LABELS[q.type]) ?? 0) + 1);
    return (
      <section aria-labelledby="mock-draft" className="space-y-3 rounded-xl border p-4">
        <h3 id="mock-draft" className="text-base font-semibold">
          {draft.title}
        </h3>
        <p className="text-sm tabular-nums">
          {draft.content.questions.length} questions · {draft.content.durationMinutes} minutes · {[...sections].map(([l, n]) => `${l} ${n}`).join(" · ")}
        </p>
        <p className="text-sm text-muted-foreground">Units: {draft.content.units.map((u) => u.title).join(", ")}</p>
        <p className="text-xs text-muted-foreground">AI-made practice paper. It is not the real exam and never a mark. Questions stay hidden until you start.</p>
        <div className="flex gap-2">
          <Button
            disabled={saving}
            onClick={() =>
              start(async () => {
                const res = await saveMockExam(institutionSlug, { title: draft.title, content: draft.content, focusUnitIds: draft.focusUnitIds, ...(draft.subjectId ? { subjectId: draft.subjectId } : {}) });
                if (!res.ok) {
                  toast.error(describeActionError(res.error));
                  return;
                }
                router.push(`/${institutionSlug}/portal/study/studio?tab=quiz&quiz=${res.data.id}`);
              })
            }
          >
            {saving ? "Saving…" : "Keep and start"}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Discard
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Mock exam source">
        {(["paper", "units"] as const).map((m) => (
          <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} aria-pressed={mode === m} onClick={() => setMode(m)} disabled={m === "paper" && papers.length === 0}>
            {m === "paper" ? "An upcoming exam paper" : "Choose units"}
          </Button>
        ))}
      </div>
      {mode === "paper" ? (
        papers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exam papers scheduled for your class yet. Choose units instead.</p>
        ) : (
          <label className="block text-sm">
            Exam paper
            <select className={selectClass} value={paperId} onChange={(e) => setPaperId(e.target.value)}>
              {papers.map((p) => (
                <option key={p.paperId} value={p.paperId}>
                  {p.label} · {p.date}
                  {p.durationMinutes ? ` · ${p.durationMinutes} min` : ""}
                </option>
              ))}
            </select>
          </label>
        )
      ) : (
        <div className="space-y-2">
          <label className="block text-sm">
            Subject
            <select
              className={selectClass}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setUnitIds([]);
              }}
            >
              {withUnits.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-sm">Units (up to {MOCK_MAX_UNITS})</legend>
            {(subject?.units ?? []).map((u) => {
              const on = unitIds.includes(u.id);
              return (
                <Button
                  key={u.id}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  onClick={() => setUnitIds(on ? unitIds.filter((x) => x !== u.id) : unitIds.length < MOCK_MAX_UNITS ? [...unitIds, u.id] : unitIds)}
                >
                  {u.title}
                </Button>
              );
            })}
          </fieldset>
          <label className="block text-sm">
            Time
            <select className={selectClass} value={duration} onChange={(e) => setDuration(Number(e.target.value) as (typeof MOCK_DURATIONS)[number])}>
              {MOCK_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          Questions
          <select className={selectClass} value={count} onChange={(e) => setCount(Number(e.target.value) as MockLength)}>
            {MOCK_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Difficulty
          <select className={selectClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d[0]!.toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div aria-live="polite">
        {busy ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-muted-foreground">Writing your mock paper…</p>
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <Button onClick={build} disabled={mode === "paper" ? !paperId : unitIds.length === 0}>
            Make mock exam
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Sections: multiple choice, true or false, short answer. Timed like the paper. Practice only.</p>
    </div>
  );
}
