"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { USE_CASES } from "./content";

const STATUS = {
  available: { label: "Available today", cls: "border-(color:--fos-ok)/40 text-(color:--fos-ok)" },
  configurable: { label: "Configured with you", cls: "border-(color:--fos-indigo)/45 text-(color:--fos-indigo)" },
} as const;

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move focus and selection. */
export function UseCaseTabs() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = USE_CASES.length;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowRight: active + 1,
      ArrowUp: active - 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: n - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + n) % n;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-14">
      <div role="tablist" aria-label="Use cases" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
        {USE_CASES.map((u, i) => {
          const on = i === active;
          return (
            <button
              key={u.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`uc-tab-${u.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`uc-panel-${u.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKey}
              className={cn(
                "flex min-h-11 shrink-0 items-center justify-between gap-4 rounded-full border px-4 text-left text-[15px] transition-colors lg:rounded-xl lg:border-transparent lg:py-3",
                on
                  ? "border-(color:--fos-line-strong) bg-(color:--fos-elev) text-(color:--fos-fg)"
                  : "border-(color:--fos-line) text-(color:--fos-muted) hover:text-(color:--fos-fg) lg:hover:bg-white/[0.03]",
              )}
            >
              <span className="whitespace-nowrap">{u.title}</span>
              {u.status === "available" ? <span aria-hidden className="hidden size-1.5 shrink-0 rounded-full bg-(color:--fos-ok) lg:block" /> : null}
            </button>
          );
        })}
      </div>

      {USE_CASES.map((u, i) => {
        const s = STATUS[u.status];
        return (
          <div
            key={u.id}
            id={`uc-panel-${u.id}`}
            role="tabpanel"
            aria-labelledby={`uc-tab-${u.id}`}
            hidden={i !== active}
            tabIndex={0}
            className="rounded-[20px] border border-(color:--fos-line-strong) bg-(color:--fos-surface) p-6 sm:p-10"
          >
            <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium", s.cls)}>{s.label}</span>
            <h3 className="mt-6 text-3xl font-medium tracking-[-0.03em] text-(color:--fos-fg) sm:text-4xl">{u.title}</h3>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-(color:--fos-muted)">{u.summary}</p>
            <ul className="mt-8 grid gap-3 border-t border-(color:--fos-line) pt-8 sm:grid-cols-3">
              {u.examples.map((ex) => (
                <li key={ex} className="flex items-start gap-2.5 text-[15px] text-(color:--fos-fg)">
                  <Check className="mt-1 size-4 shrink-0 text-(color:--fos-cyan)" aria-hidden />
                  {ex}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
