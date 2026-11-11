"use client";

// Mode switcher under the orb: a real tablist (arrow keys, Home/End and 1-6 move and
// select; roving tabindex) with a sliding pill, each mode's colour dot and count,
// the active mode's one-line hint, and a dismissible first-visit explanation.
import { motion } from "motion/react";
import { X } from "lucide-react";
import { modeInfo, type OrbMode } from "./orb-modes";

interface Props {
  modes: readonly OrbMode[];
  current: OrbMode;
  counts: Partial<Record<OrbMode, number>>;
  idBase: string;
  panelId: string;
  hueFor: (m: OrbMode) => string;
  reduced: boolean;
  showIntro: boolean;
  onDismissIntro: () => void;
  onChange: (m: OrbMode) => void;
}

const SPRING = { type: "spring", stiffness: 480, damping: 34 } as const;

/** Tab index for a key on the tablist, or null when the key is not ours. */
export function tabKeyTarget(key: string, at: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (/^[1-6]$/.test(key) && Number(key) <= n) return Number(key) - 1;
  return null;
}

export const tabId = (idBase: string, m: OrbMode) => `${idBase}-tab-${m}`;

export function OrbModes({ modes, current, counts, idBase, panelId, hueFor, reduced, showIntro, onDismissIntro, onChange }: Props) {
  function onKeyDown(e: React.KeyboardEvent) {
    const next = tabKeyTarget(e.key, modes.indexOf(current), modes.length);
    if (next === null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    onChange(modes[next]);
    document.getElementById(tabId(idBase, modes[next]))?.focus();
  }
  if (modes.length === 0) return null;
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div
        role="tablist"
        aria-label="Orb modes"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm [scrollbar-width:none]"
      >
        {modes.map((m, i) => {
          const on = m === current;
          const count = counts[m] ?? 0;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              id={tabId(idBase, m)}
              aria-selected={on}
              aria-controls={panelId}
              aria-keyshortcuts={String(i + 1)}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(m)}
              className={`relative min-h-11 min-w-11 shrink-0 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                on ? "text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {on && <motion.span layoutId={`${idBase}-pill`} className="absolute inset-0 rounded-full bg-foreground" transition={reduced ? { duration: 0 } : SPRING} />}
              <span className="relative flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: hueFor(m) }} aria-hidden />
                {modeInfo(m).label}
                {count > 0 && (
                  <span className="hidden text-xs tabular-nums opacity-75 sm:inline">
                    {count}
                    <span className="sr-only"> {count === 1 ? "item" : "items"}</span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-4 text-center text-xs text-muted-foreground">{modeInfo(current).hint}</p>
      {showIntro && modes.length > 1 && (
        <div role="note" className="flex max-w-xl items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-sm">
          <p className="flex-1 leading-relaxed">
            Modes sort what the orb can do: Ask answers questions and the others prepare work you approve on a card; switch with these tabs, keys 1–{modes.length}, or a flick of the orb.
          </p>
          <button
            type="button"
            onClick={onDismissIntro}
            aria-label="Dismiss the modes tip"
            className="-m-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
