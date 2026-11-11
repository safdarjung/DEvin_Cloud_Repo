"use client";

import { ArrowUp, ArrowUpRight, CornerDownRight, Search } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { orbUrl, suggestionsFor } from "./suggestions";

export type Corner = "br" | "bl" | "tr" | "tl";
export interface JumpItem {
  href: string;
  label: string;
  group: string;
}

// Mobile: full-width sheet beside the orb (above the bottom nav). lg: 360px, anchored to the orb's side.
const POS: Record<Corner, string> = {
  br: "bottom-[calc(8.75rem+env(safe-area-inset-bottom))] lg:right-6 lg:bottom-[6.25rem]",
  bl: "bottom-[calc(8.75rem+env(safe-area-inset-bottom))] lg:left-6 lg:bottom-[6.25rem]",
  tr: "top-36 lg:right-6 lg:top-[9.75rem]",
  tl: "top-36 lg:left-6 lg:top-[9.75rem]",
};
const ORIGIN: Record<Corner, string> = { br: "bottom right", bl: "bottom left", tr: "top right", tl: "top left" };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';
const CHIP =
  "rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface Props {
  slug: string;
  pathname: string;
  title: string;
  items: JumpItem[];
  corner: Corner;
  reduced: boolean;
  /** Which field takes focus on open: the ask box, or the jump filter (shortcut). */
  focus: "ask" | "jump";
  onClose: () => void;
}

export function AskAiPanel({ slug, pathname, title, items, corner, reduced, focus, onClose }: Props) {
  const router = useRouter();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const jumpRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState("");
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => suggestionsFor(pathname), [pathname]);
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)) : items).slice(0, 30);
  }, [items, filter]);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    (focus === "jump" ? jumpRef : askRef).current?.focus();
  }, [focus]);

  // Keyboard: Ctrl/Cmd+J (re)focuses the jump filter, "/" focuses the ask box, Tab stays inside.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        jumpRef.current?.focus();
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        askRef.current?.focus();
      } else if (e.key === "Tab" && root.current) {
        const els = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = els[0];
        const last = els[els.length - 1];
        if (!first || !last) return;
        const a = document.activeElement;
        if (!root.current.contains(a)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && a === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && a === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function ask(text: string) {
    if (!text.trim()) return;
    router.push(orbUrl(slug, pathname, text));
    onClose();
  }

  function onJumpKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = matches.length;
      if (n) setActive((current + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" && matches[current]) {
      e.preventDefault();
      router.push(matches[current].href);
      onClose();
    }
  }

  const listId = `${id}-jump`;
  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      style={{ transformOrigin: ORIGIN[corner] }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
      transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 380, damping: 26 }}
      className={`fixed inset-x-2 z-(--z-header) flex max-h-[calc(100dvh-13rem)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-xl lg:inset-x-auto lg:w-[360px] print:hidden ${POS[corner]}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex items-center gap-1 rounded-full border border-border bg-background p-1 focus-within:ring-2 focus-within:ring-ring"
      >
        <input
          ref={askRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label={`Ask anything about ${title}`}
          placeholder={`Ask anything about ${title}…`}
          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" disabled={!question.trim()} aria-label="Ask" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30">
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </form>

      <section aria-label="On this page">
        <h2 className="mb-1.5 flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <CornerDownRight className="size-3.5" aria-hidden />
          On this page
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className={CHIP}>
              {s}
            </button>
          ))}
        </div>
      </section>

      {items.length > 0 && (
        <section aria-label="Jump to">
          <h2 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Jump to</h2>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={jumpRef}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setActive(0);
              }}
              onKeyDown={onJumpKey}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={matches[current] ? `${id}-opt-${current}` : undefined}
              aria-label="Filter pages"
              placeholder="Type to filter pages…"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Pages" className="mt-1 max-h-44 overflow-y-auto">
            {matches.map((m, i) => (
              <li
                key={m.href}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === current}
                ref={(el) => {
                  if (el && i === current) el.scrollIntoView({ block: "nearest" });
                }}
                onMouseMove={() => setActive(i)}
                onClick={() => {
                  router.push(m.href);
                  onClose();
                }}
                className={`flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${i === current ? "bg-accent text-accent-foreground" : ""}`}
              >
                {m.label}
                <span className="text-[11px] text-muted-foreground">{m.group}</span>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2.5 py-1.5 text-sm text-muted-foreground">No matching page</li>}
          </ul>
        </section>
      )}

      <Link
        href={orbUrl(slug, pathname)}
        onClick={onClose}
        className="flex items-center justify-between rounded-lg border-t border-border px-1 pt-3 text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Open full assistant
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </motion.div>
  );
}
