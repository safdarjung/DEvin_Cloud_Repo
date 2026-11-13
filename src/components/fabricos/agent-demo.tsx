"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { AGENT_DEMO } from "./content";

const STEPS = AGENT_DEMO.steps;
const ADVANCE_MS = 3400;

// One trace line per step: what the agent did, written as a run log.
// Purely illustrative, rendered client-side. No network, no backend.
const TRACE: Record<(typeof STEPS)[number]["id"], [string, string]> = {
  request: ["ask", "Class 8 · missed 3+ days · this month · draft parent note"],
  understand: ["scope", "class = 8   range = this month   rule = absences ≥ 3"],
  information: ["read", "attendance for the teacher's own classes only"],
  proposal: ["draft", "matching students listed · one note per family"],
  review: ["wait", "teacher edits, approves or discards each draft"],
  result: ["queue", "approved notes queued · nothing sent without the teacher"],
};

const RM_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeRM(cb: () => void) {
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeRM,
    () => window.matchMedia(RM_QUERY).matches,
    () => true, // server: assume reduced, so nothing autoplays before hydration
  );
}

export function AgentDemo() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const last = STEPS.length - 1;
  // Reduced motion: never auto-advance; the visitor steps through by hand.
  const isPlaying = playing && !reduced;
  const autoplay = isPlaying && inView;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplay || index >= last) return;
    const t = window.setTimeout(() => {
      const next = Math.min(index + 1, last);
      setIndex(next);
      if (next >= last) setPlaying(false);
    }, ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [autoplay, index, last]);

  const go = (i: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(last, i)));
  };
  const togglePlay = () => {
    if (isPlaying) return setPlaying(false);
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  const step = STEPS[index];
  const atEnd = index >= last;

  return (
    <div
      ref={root}
      data-agent-demo
      className="overflow-hidden rounded-[20px] border border-(color:--fos-line-strong) bg-(color:--fos-surface)"
    >
      {/* Header: honesty label + transport controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(color:--fos-line) px-4 py-3 sm:px-6">
        <p className="fos-tag">{AGENT_DEMO.label}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} className="grid size-11 place-items-center rounded-full text-(color:--fos-muted) transition-colors hover:bg-white/5 hover:text-(color:--fos-fg) disabled:opacity-35 disabled:hover:bg-transparent" aria-label="Previous step">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={togglePlay} className="grid size-11 place-items-center rounded-full text-(color:--fos-muted) transition-colors hover:bg-white/5 hover:text-(color:--fos-fg)" aria-label={isPlaying ? "Pause walkthrough" : atEnd ? "Replay walkthrough" : "Play walkthrough"}>
            {isPlaying ? <Pause className="size-4" aria-hidden /> : atEnd ? <RotateCcw className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={atEnd} className="grid size-11 place-items-center rounded-full text-(color:--fos-muted) transition-colors hover:bg-white/5 hover:text-(color:--fos-fg) disabled:opacity-35 disabled:hover:bg-transparent" aria-label="Next step">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Step rail */}
        <ol className="flex gap-1 overflow-x-auto border-b border-(color:--fos-line) p-3 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-4" aria-label="Walkthrough steps">
          {STEPS.map((s, i) => {
            const state = i < index ? "done" : i === index ? "current" : "todo";
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors",
                    state === "current" ? "bg-(color:--fos-elev) text-(color:--fos-fg)" : "text-(color:--fos-muted) hover:bg-white/[0.03] hover:text-(color:--fos-fg)",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] transition-colors",
                      state === "current" && "border-(color:--fos-cyan) text-(color:--fos-cyan)",
                      state === "done" && "border-(color:--fos-indigo) bg-(color:--fos-indigo) text-(color:--fos-accent-fg)",
                      state === "todo" && "border-(color:--fos-line-strong)",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap lg:whitespace-normal">{s.title}</span>
                  {state === "current" && autoplay ? (
                    <span aria-hidden className="ml-auto hidden h-0.5 w-10 overflow-hidden rounded-full bg-white/10 lg:block">
                      <span key={index} className="block h-full origin-left bg-(color:--fos-cyan)" style={{ animation: `fos-progress ${ADVANCE_MS}ms linear forwards` }} />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>

        {/* Stage */}
        <div className="flex min-h-[340px] flex-col p-5 sm:p-8">
          <figure className="rounded-2xl border border-(color:--fos-line) bg-(color:--fos-bg) p-4 sm:p-5">
            <figcaption className="text-xs text-(color:--fos-muted)">Class teacher asks</figcaption>
            <blockquote className="mt-2 text-base leading-relaxed text-(color:--fos-fg) sm:text-lg">&ldquo;{AGENT_DEMO.request}&rdquo;</blockquote>
          </figure>

          <div aria-live={isPlaying ? "off" : "polite"} className="mt-6">
            <h3 className="text-xl font-medium tracking-[-0.02em] text-(color:--fos-fg)">{step.title}</h3>
            <p className="mt-2 max-w-prose leading-relaxed text-(color:--fos-muted)">{step.body}</p>
          </div>

          <ol className="mt-6 space-y-1.5 font-mono text-[12.5px] leading-relaxed" aria-label="Agent run log">
            {STEPS.slice(0, index + 1).map((s, i) => {
              const [verb, text] = TRACE[s.id];
              return (
                <li key={s.id} className="flex gap-3" style={i === index ? { animation: "fos-line-in 500ms var(--fos-ease) both" } : undefined}>
                  <span className={cn("w-12 shrink-0", s.id === "review" ? "text-(color:--fos-warn)" : s.id === "result" ? "text-(color:--fos-ok)" : "text-(color:--fos-cyan)")}>{verb}</span>
                  <span className={i === index ? "text-(color:--fos-fg)" : "text-(color:--fos-muted)"}>{text}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
