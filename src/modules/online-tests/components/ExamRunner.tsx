"use client";

// Phase 4 exam runner. The server is the clock and the truth: remaining time is
// (deadline - serverNow) counted on the monotonic performance clock, so changing
// the device clock does nothing. localStorage only buffers answers not yet
// acknowledged by the server; on load the server copy wins unless the buffer is newer.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveResponse, submitAttempt } from "@/modules/online-tests/actions";
import type { AttemptPaper } from "@/modules/online-tests/queries";
import type { Answer } from "@/modules/online-tests/schemas";
import { createClient } from "@/lib/supabase/client";
import { AnswerInput, isAnswered } from "./AnswerInput";
import { markDocumentTimingUsed, responseAt } from "./runner-clock";
import { fmtNum } from "./test-ui";

type Entry = { answer: Answer | null; flagged: boolean };
type Buffer = Record<string, Entry & { ts: number }>;
type SaveState = "saved" | "saving" | "unsaved";

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

const bufKey = (attemptId: string) => `coolskool:attempt:${attemptId}`;
function readBuffer(attemptId: string): Buffer {
  try { return JSON.parse(localStorage.getItem(bufKey(attemptId)) ?? "{}") as Buffer; } catch { return {}; }
}
function writeBuffer(attemptId: string, buf: Buffer) {
  try { if (Object.keys(buf).length) localStorage.setItem(bufKey(attemptId), JSON.stringify(buf)); else localStorage.removeItem(bufKey(attemptId)); } catch { /* storage blocked: server save still works */ }
}
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function ExamRunner({ slug, paper }: { slug: string; paper: AttemptPaper }) {
  const router = useRouter();
  const attemptId = paper.attempt.id;
  const flat = useMemo(() => paper.sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s }))), [paper]);

  // Monotonic end time from (deadline - serverNow), counted from when the server answered, not from hydration; immune to device clock changes.
  const startMs = Date.parse(paper.attempt.deadline) - Date.parse(paper.attempt.serverNow);
  const [endAt] = useState(() => (typeof window === "undefined" ? 0 : responseAt()) + startMs);
  useEffect(markDocumentTimingUsed, []);
  const [remaining, setRemaining] = useState(startMs);

  const [entries, setEntries] = useState<Record<string, Entry>>(() => {
    const base: Record<string, Entry> = {};
    for (const r of paper.responses) { base[r.itemKey] = { answer: r.answer as Answer | null, flagged: r.flagged } }
    return base;
  });
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [idx, setIdx] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(true);

  const latest = useRef(entries);
  const dirty = useRef<Set<string>>(new Set());
  const version = useRef<Record<string, number>>({});
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);

  const setState = (key: string, s: SaveState) => setStates((cur) => (cur[key] === s ? cur : { ...cur, [key]: s }));

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      for (const key of [...dirty.current]) {
        const v = version.current[key] ?? 0;
        const e = latest.current[key] ?? { answer: null, flagged: false };
        setState(key, "saving");
        let ok = false;
        try {
          const r = await saveResponse(slug, { attemptId, itemKey: key, answer: e.answer, flagged: e.flagged });
          ok = r.ok;
          // Time is up / attempt closed: stop retrying, the page reloads into the result.
          if (!r.ok && r.error.code === "invalid_state") { dirty.current.delete(key); done.current = true; router.replace(`/${slug}/portal/tests/result/${attemptId}`); return; }
        } catch { ok = false; }
        if (ok && (version.current[key] ?? 0) === v) {
          dirty.current.delete(key);
          setState(key, "saved");
          const buf = readBuffer(attemptId);
          delete buf[key];
          writeBuffer(attemptId, buf);
        } else {
          setState(key, "unsaved");
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [slug, attemptId, router]);

  const schedule = useCallback((delay = DEBOUNCE_MS) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [flush]);

  const update = (key: string, patch: Partial<Entry>) => {
    const next = { ...(latest.current[key] ?? { answer: null, flagged: false }), ...patch };
    latest.current = { ...latest.current, [key]: next };
    setEntries(latest.current);
    version.current[key] = (version.current[key] ?? 0) + 1;
    dirty.current.add(key);
    setState(key, "unsaved");
    writeBuffer(attemptId, { ...readBuffer(attemptId), [key]: { ...next, ts: Date.now() } });
    schedule();
  };

  // Buffer from a previous page load (reload, offline): re-send what the server has not seen.
  useEffect(() => {
    const t = setTimeout(() => {
      const buf = readBuffer(attemptId);
      const saved = new Map(paper.responses.map((r) => [r.itemKey, Date.parse(r.savedAt)]));
      const fresh = Object.entries(buf).filter(([key, e]) => e.ts > (saved.get(key) ?? 0));
      if (fresh.length === 0) { writeBuffer(attemptId, {}); return; }
      for (const [key, e] of fresh) {
        latest.current = { ...latest.current, [key]: { answer: e.answer, flagged: e.flagged } };
        dirty.current.add(key);
        setState(key, "unsaved");
      }
      setEntries(latest.current);
      void flush();
    }, 0);
    return () => clearTimeout(t);
  }, [attemptId, paper.responses, flush]);

  const finish = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    setSubmitting(true);
    if (timer.current) clearTimeout(timer.current);
    for (let i = 0; i < 3 && dirty.current.size > 0; i += 1) {
      while (inFlight.current) await new Promise((r) => setTimeout(r, 100));
      await flush();
    }
    const r = await submitAttempt(slug, { attemptId });
    if (!r.ok && r.error.code !== "invalid_state") { done.current = false; setSubmitting(false); return; }
    writeBuffer(attemptId, {});
    router.replace(`/${slug}/portal/tests/result/${attemptId}`);
  }, [flush, slug, attemptId, router]);

  // Countdown + auto-submit.
  useEffect(() => {
    const t = setInterval(() => {
      const left = endAt - performance.now();
      setRemaining(left);
      if (left <= 0) void finish();
    }, 500);
    return () => clearInterval(t);
  }, [finish, endAt]);

  // Retry unsent answers; flush when the network returns.
  useEffect(() => {
    const retry = setInterval(() => { if (dirty.current.size > 0) void flush(); }, RETRY_MS);
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    const t0 = setTimeout(() => setOnline(navigator.onLine), 0);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { clearTimeout(t0); clearInterval(retry); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [flush]);

  // Focus-lost log (audit trail only; the teacher sees the count).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && !done.current) void createClient().rpc("log_test_focus_lost", { p_attempt_id: attemptId }); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [attemptId]);

  const go = (n: number) => { void flush(); setIdx(Math.min(Math.max(n, 0), flat.length - 1)); };
  const item = flat[idx];
  const e = entries[item?.key] ?? { answer: null, flagged: false };
  const unanswered = flat.map((it, n) => ({ n: n + 1, it })).filter(({ it }) => !isAnswered(entries[it.key]?.answer));
  const flaggedList = flat.map((it, n) => ({ n: n + 1, it })).filter(({ it }) => entries[it.key]?.flagged);
  const pending = Object.values(states).filter((s) => s !== "saved").length;
  const saving = Object.values(states).some((s) => s === "saving");
  const low = remaining < 5 * 60_000;

  if (!item) return <p className="text-sm text-muted-foreground">This test has no questions.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-1 py-2 backdrop-blur">
        <h1 className="min-w-0 truncate text-base font-semibold">{paper.test.title}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span data-testid="save-state" role="status" className={pending && !saving ? "text-warning" : "text-muted-foreground"}>
            {!online ? "Offline: answers kept on this device, will send when back online" : saving ? "Saving..." : pending ? "Unsaved changes, retrying" : "All answers saved"}
          </span>
          <span role="timer" data-testid="runner-timer" aria-label={`Time left ${mmss(remaining)}`} className={`rounded-md border px-2 py-1 font-mono text-base tabular-nums ${remaining < 60_000 ? "border-destructive text-destructive" : low ? "border-warning text-warning" : ""}`}>
            {mmss(remaining)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <section aria-labelledby="q-h" className="space-y-4">
          <div className="text-xs text-muted-foreground">{item.section.title} · Question {idx + 1} of {flat.length} · {fmtNum(item.marks)} mark{item.marks === 1 ? "" : "s"}{item.section.chooseCount ? ` · answer any ${item.section.chooseCount} in this section` : ""}</div>
          {idx === 0 || flat[idx - 1].section.id !== item.section.id ? (item.section.instructions ? <p className="rounded-md bg-muted/50 p-2 text-sm">{item.section.instructions}</p> : null) : null}
          <h2 id="q-h" className="sr-only">Question {idx + 1}</h2>
          <div className="whitespace-pre-wrap text-base" data-testid="question-body">{item.body}</div>
          <AnswerInput key={item.key} item={item} value={e.answer} onChange={(a) => update(item.key, { answer: a })} />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button variant="outline" onClick={() => go(idx - 1)} disabled={idx === 0}>Previous</Button>
            <Button variant="outline" onClick={() => go(idx + 1)} disabled={idx === flat.length - 1}>Next</Button>
            <Button variant={e.flagged ? "secondary" : "ghost"} aria-pressed={e.flagged} data-testid="flag-toggle" onClick={() => update(item.key, { flagged: !e.flagged })}>
              <Flag className="size-4" aria-hidden /> {e.flagged ? "Marked for review" : "Mark for review"}
            </Button>
            <span className="text-xs text-muted-foreground" data-testid="item-save-state">{states[item.key] === "saving" ? "Saving..." : states[item.key] === "unsaved" ? "Not saved yet" : isAnswered(e.answer) ? "Saved" : ""}</span>
          </div>
        </section>

        <aside aria-label="Question palette" className="space-y-3">
          <ol className="grid grid-cols-5 gap-1.5">
            {flat.map((it, n) => {
              const en = entries[it.key];
              const answered = isAnswered(en?.answer);
              const st = states[it.key];
              const label = `Question ${n + 1}, ${answered ? "answered" : "not answered"}${en?.flagged ? ", marked for review" : ""}${st && st !== "saved" ? ", not saved yet" : ""}`;
              return (
                <li key={it.key}>
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={n === idx ? "step" : undefined}
                    data-testid={`palette-q${n + 1}`}
                    data-answered={answered}
                    onClick={() => go(n)}
                    className={`relative flex size-10 w-full items-center justify-center rounded-md border text-sm tabular-nums ${n === idx ? "ring-2 ring-ring" : ""} ${answered ? "border-success bg-success/15" : "bg-background"}`}
                  >
                    {n + 1}
                    {en?.flagged && <Flag className="absolute -right-1 -top-1 size-3 fill-warning text-warning" aria-hidden />}
                    {st && st !== "saved" && <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-warning" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">Green: answered. Flag: marked for review. Dot: not saved yet.</p>
          <Button className="w-full" data-testid="submit-button" onClick={() => { void flush(); setConfirmOpen(true); }} disabled={submitting}>Submit test</Button>
        </aside>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="submit-dialog">
          <DialogHeader>
            <DialogTitle>Submit your test?</DialogTitle>
            <DialogDescription>You cannot change answers after you submit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{flat.length - unanswered.length} of {flat.length} answered.</p>
            {unanswered.length > 0 && <p data-testid="unanswered-list">Unanswered: {unanswered.map((u) => `Q${u.n}`).join(", ")}.</p>}
            {flaggedList.length > 0 && <p>Marked for review: {flaggedList.map((u) => `Q${u.n}`).join(", ")}.</p>}
            {pending > 0 && <p className="text-warning">Some answers are still being saved. They will be sent first.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Keep working</Button>
            <Button data-testid="submit-confirm" disabled={submitting} onClick={() => void finish()}>{submitting ? "Submitting..." : "Submit now"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
