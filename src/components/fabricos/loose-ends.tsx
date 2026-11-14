"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "cn";
import { HONESTY_TEXT, PROBLEMS, THREAD } from "@/components/home/story";
import { tabKeyDown } from "@/components/home/tabs";
import { BRAND, PROBLEM, SECTION } from "./content";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = SECTION.platform;
const DWELL_MS = 6000;
const hue = (thread: string) => ({ "--hue": `var(--th-${thread})` }) as CSSProperties;

/**
 * The problem, concretely: seven things an institution runs on today, and what replaces each.
 * Steps through them on its own while in view until the visitor picks one.
 */
export function LooseEnds() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const p = PROBLEMS[active];

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !inView) return;
    const timer = setTimeout(() => setActive((a) => (a + 1) % PROBLEMS.length), DWELL_MS);
    return () => clearTimeout(timer);
  }, [auto, inView, active]);

  const pick = (i: number) => {
    setAuto(false);
    setActive(i);
  };

  return (
    <SectionShell id={id} className="border-t border-(color:--fos-line)">
      <ScrollReveal>
        <div className="max-w-3xl">
          <p className="fos-eyebrow" data-reveal>
            The problem
          </p>
          <h2 id={`${id}-title`} className="fos-h2 mt-5" data-reveal>
            Seven loose ends. One live record.
          </h2>
          <p className="fos-lead mt-6" data-reveal>
            {PROBLEM.lead}
          </p>
        </div>

        <div ref={root} className="mt-14 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10" data-reveal>
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="What institutions run on today"
            className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0"
            onKeyDown={(e) => tabKeyDown(e, PROBLEMS.length, active, pick)}
          >
            {PROBLEMS.map((item, i) => {
              const on = i === active;
              return (
                <button
                  key={item.thread}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${item.thread}`}
                  aria-selected={on}
                  aria-controls={`${id}-panel`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => pick(i)}
                  style={hue(item.thread)}
                  className={cn(
                    "group relative flex min-h-11 shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-4 py-3 text-left transition-colors duration-300",
                    on ? "border-(color:--fos-line-strong) bg-(color:--fos-elev)" : "border-transparent hover:bg-white/[0.03]",
                  )}
                >
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-(color:--hue) transition-shadow duration-300", on && "shadow-[0_0_0_4px_color-mix(in_oklab,var(--hue)_25%,transparent)]")} />
                  <span className="min-w-0">
                    <span className={cn("block font-medium whitespace-nowrap transition-colors", on ? "text-(color:--fos-fg)" : "text-(color:--fos-muted) group-hover:text-(color:--fos-fg)")}>{item.artefact}</span>
                    <span className="hidden truncate text-sm text-(color:--fos-faint) lg:block">{item.pain}</span>
                  </span>
                  {on && auto && inView ? <span key={active} aria-hidden className="fos-timer absolute inset-x-0 bottom-0 h-px bg-(color:--hue)" style={{ "--dur": `${DWELL_MS}ms` } as CSSProperties} /> : null}
                </button>
              );
            })}
          </div>

          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${p.thread}`} className="fos-panel flex flex-col p-6 sm:p-10" style={hue(p.thread)}>
            <div key={p.thread} className="fos-swap flex flex-1 flex-col">
              <p className="font-(family-name:--fos-font-mono) text-xs tracking-[0.08em] text-(color:--fos-faint) uppercase">Today · {p.artefact}</p>
              <p className="mt-4 text-2xl leading-tight font-medium tracking-[-0.025em] text-(color:--fos-fg) sm:text-[2rem]">{p.pain}</p>
              <p className="mt-3 max-w-[52ch] leading-relaxed text-(color:--fos-muted)">{p.detail}</p>

              <div className="my-8 flex items-center gap-4" aria-hidden>
                <span className="grid size-9 place-items-center rounded-full border border-(color:--hue) text-(color:--hue)">
                  <ArrowDown className="size-4" />
                </span>
                <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--hue),transparent)]" />
              </div>

              <p className="font-(family-name:--fos-font-mono) text-xs tracking-[0.08em] text-(color:--hue) uppercase">With {BRAND}</p>
              <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-(color:--fos-fg) sm:text-xl">{p.fix}</p>
              {p.label ? (
                <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-snug text-(color:--fos-muted)">
                  <span className="fos-honest">{HONESTY_TEXT[p.label]}</span>
                  {p.labelNote}
                </p>
              ) : null}
              <p className="mt-auto flex items-center justify-between gap-4 pt-10 font-(family-name:--fos-font-mono) text-xs tracking-[0.06em] text-(color:--fos-faint) uppercase">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-1.5 rounded-full bg-(color:--hue)" />
                  {THREAD[p.thread].label}
                </span>
                <span>
                  0{active + 1} / 0{PROBLEMS.length}
                </span>
              </p>
            </div>
          </div>
        </div>

        <p className="mt-12 max-w-2xl border-t border-(color:--fos-line-strong) pt-6 text-lg leading-relaxed text-(color:--fos-fg)" data-reveal>
          {PROBLEM.resolution}
        </p>
      </ScrollReveal>
    </SectionShell>
  );
}
