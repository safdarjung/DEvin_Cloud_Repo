"use client";

// The orb's sections: one real button per group (name, icon, count) that opens a
// small popover (a bottom sheet on phones) with ready prompts and that section's AI
// tools, plus a search across every prompt. Radix handles focus-in, Esc, return
// focus and outside click; this file adds hover intent, roving arrow keys and motion.
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight, Banknote, Building2, CalendarCheck, CalendarClock, ClipboardList, Globe, GraduationCap, History,
  Lightbulb, Megaphone, NotebookPen, Pencil, Search, Sparkles, Trophy, Users, BookOpen,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { RECENT_HUE, searchPrompts, type OrbGroup, type OrbGroupId } from "./orb-groups";

type GroupIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const ICONS: Record<OrbGroupId | "recent", GroupIcon> = {
  attendance: CalendarCheck, exams: GraduationCap, teaching: BookOpen, study: NotebookPen, finance: Banknote,
  admissions: ClipboardList, timetable: CalendarClock, people: Users, insights: Lightbulb, calendar: Megaphone,
  clubs: Trophy, operations: Building2, website: Globe, more: Sparkles, recent: History,
};

interface ShownGroup extends Omit<OrbGroup, "id"> {
  id: OrbGroupId | "recent";
}

interface Props {
  groups: OrbGroup[];
  recent: string[];
  busy: boolean;
  reduced: boolean;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
  /** The open group's button and colour (null when none), so the orb can lean toward it and pulse. */
  onActive: (el: HTMLElement | null, hue: string) => void;
}

const SMALL = "(max-width: 639px)";
const subscribeSmall = (cb: () => void) => {
  const mq = window.matchMedia(SMALL);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const HOVER_INTENT_MS = 140;
const SPRING = { type: "spring", stiffness: 420, damping: 24, mass: 0.8 } as const;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW_BTN = `min-h-11 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60 ${FOCUS}`;

function Panel({ group, titleId, busy, reduced, onChoose, onEdit }: {
  group: ShownGroup; titleId: string; busy: boolean; reduced: boolean; onChoose: (t: string) => void; onEdit: (t: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  function onKeyDown(e: React.KeyboardEvent) {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const at = rows.findIndex((r) => r.contains(document.activeElement));
    const main = (i: number) => rows[Math.min(rows.length - 1, Math.max(0, i))]?.querySelector<HTMLElement>("[data-main]");
    const here = document.activeElement as HTMLElement | null;
    if (e.key === "ArrowDown") main(at + 1)?.focus();
    else if (e.key === "ArrowUp") main(at - 1)?.focus();
    else if (e.key === "Home") main(0)?.focus();
    else if (e.key === "End") main(rows.length - 1)?.focus();
    else if (e.key === "ArrowRight" && here?.hasAttribute("data-main")) rows[at]?.querySelector<HTMLElement>("[data-edit]")?.focus();
    else if (e.key === "ArrowLeft" && here?.hasAttribute("data-edit")) main(at)?.focus();
    else return;
    e.preventDefault();
  }
  let n = 0;
  const item = (extra?: object) => (reduced ? { initial: false as const } : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING, delay: 0.04 + 0.03 * n++ }, ...extra });
  return (
    <motion.div
      ref={root}
      onKeyDown={onKeyDown}
      {...(reduced ? { initial: false as const } : { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 }, transition: SPRING })}
      style={{ transformOrigin: "var(--radix-popover-content-transform-origin, 50% 0)" }}
    >
      <h3 id={titleId} className="flex items-center gap-2 px-1 text-sm font-semibold">
        <span className="size-2.5 rounded-full" style={{ background: group.hue }} aria-hidden />
        {group.label}
      </h3>
      {group.prompts.length > 0 && (
        <ul aria-label={`Ready prompts for ${group.label}`} className="mt-2 space-y-0.5">
          {group.prompts.map((p) => (
            <motion.li key={p} data-row className="flex items-stretch gap-0.5" {...item()}>
              <button type="button" data-main disabled={busy} onClick={() => onChoose(p)} className={`${ROW_BTN} flex-1`}>
                {p}
              </button>
              <button
                type="button"
                data-edit
                disabled={busy}
                onClick={() => onEdit(p)}
                aria-label={`Edit before sending: ${p}`}
                title="Put in the message box to edit"
                className={`grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60 ${FOCUS}`}
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            </motion.li>
          ))}
        </ul>
      )}
      {group.tools.length > 0 && (
        <>
          <h4 className="mt-3 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">AI tools</h4>
          <ul aria-label={`AI tools for ${group.label}`} className="mt-1 space-y-0.5">
            {group.tools.map((t) => (
              <motion.li key={t.key} data-row {...item()}>
                {t.href ? (
                  <Link href={t.href} data-main className={`${ROW_BTN} flex items-center justify-between gap-2`}>
                    <span>{t.label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Opens page <ArrowUpRight className="size-3.5" aria-hidden />
                    </span>
                  </Link>
                ) : (
                  <button type="button" data-main disabled={busy || !t.prompt} onClick={() => t.prompt && onChoose(t.prompt)} className={`${ROW_BTN} flex w-full items-center justify-between gap-2`}>
                    <span>{t.label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Starts a draft <Sparkles className="size-3.5" aria-hidden />
                    </span>
                  </button>
                )}
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  );
}

export function OrbGroups({ groups, recent, busy, reduced, onSend, onEdit, onActive }: Props) {
  const uid = useId();
  const small = useSyncExternalStore(subscribeSmall, () => window.matchMedia(SMALL).matches, () => false);
  const all: ShownGroup[] = recent.length ? [{ id: "recent", label: "Recent", hue: RECENT_HUE, prompts: recent, tools: [], count: recent.length }, ...groups] : groups;
  const [openId, setOpenId] = useState<string | null>(null);
  const [rove, setRove] = useState(0);
  const via = useRef<"hover" | "click">("click");
  const returnFocus = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const open = all.find((g) => g.id === openId) ?? null;

  const buttonFor = (id: string) => bar.current?.querySelector<HTMLElement>(`[data-group="${id}"]`) ?? null;
  const activeId = open?.id;
  const activeHue = open?.hue ?? "";
  useEffect(() => {
    onActive(activeId ? buttonFor(activeId) : null, activeHue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notify only when the open group changes
  }, [activeId, activeHue]);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  function show(id: string, how: "hover" | "click") {
    via.current = how;
    setOpenId(id);
  }
  function close(refocus: boolean) {
    returnFocus.current = refocus;
    setOpenId(null);
  }
  function choose(text: string) {
    close(true);
    onSend(text);
  }
  function edit(text: string) {
    close(false);
    onEdit(text);
  }
  function afterClose(e: Event) {
    e.preventDefault();
    if (returnFocus.current) {
      // The group that was open holds the roving stop (opening focused it).
      bar.current?.querySelectorAll<HTMLElement>("[data-group]")[Math.min(rove, all.length - 1)]?.focus();
    }
    returnFocus.current = false;
  }

  function onBarKey(e: React.KeyboardEvent) {
    const items = [...(bar.current?.querySelectorAll<HTMLElement>("[data-group]") ?? [])];
    const at = items.findIndex((el) => el === document.activeElement);
    if (at < 0) return;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  }

  const panel = (g: ShownGroup) => (
    <Panel group={g} titleId={`${uid}-t-${g.id}`} busy={busy} reduced={reduced} onChoose={choose} onEdit={edit} />
  );

  return (
    <div className="space-y-3">
      <PromptSearch groups={all} busy={busy} reduced={reduced} onSend={onSend} />
      <div ref={bar} role="group" aria-label="Sections" onKeyDown={onBarKey} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center">
        {all.map((g, i) => {
          const Icon = ICONS[g.id];
          const isOpen = openId === g.id;
          const button = (
            <motion.button
              type="button"
              data-group={g.id}
              tabIndex={i === Math.min(rove, all.length - 1) ? 0 : -1}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
              aria-controls={`${uid}-p-${g.id}`}
              onFocus={() => setRove(i)}
              onClick={() => (isOpen && via.current === "click" ? close(true) : show(g.id, "click"))}
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse" || small) return;
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => show(g.id, "hover"), HOVER_INTENT_MS);
              }}
              onPointerLeave={() => hoverTimer.current && clearTimeout(hoverTimer.current)}
              whileHover={reduced ? undefined : { y: -3 }}
              whileFocus={reduced ? undefined : { y: -3 }}
              transition={SPRING}
              className={`flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm font-medium shadow-xs hover:bg-accent aria-expanded:border-2 aria-expanded:border-foreground aria-expanded:bg-accent ${FOCUS}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${g.hue} 18%, transparent)` }}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 leading-tight">{g.label}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {g.count}
                <span className="sr-only"> {g.count === 1 ? "option" : "options"}</span>
              </span>
            </motion.button>
          );
          if (small) return <div key={g.id} className="contents">{button}</div>;
          return (
            <Popover key={g.id} open={isOpen} onOpenChange={(o) => !o && setOpenId(null)}>
              <PopoverAnchor asChild>{button}</PopoverAnchor>
              <PopoverContent
                  id={`${uid}-p-${g.id}`}
                  role="dialog"
                  aria-labelledby={`${uid}-t-${g.id}`}
                  side="bottom"
                  // Start-aligned: a centred popover under the first group in a row slid over the sidebar.
                  align="start"
                  sideOffset={10}
                  collisionPadding={12}
                  className="max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-2 data-open:animate-none data-closed:animate-none"
                  onOpenAutoFocus={(e) => {
                    // Hover is a peek: keep focus where it is. Click/keys move focus to the first prompt.
                    e.preventDefault();
                    if (via.current === "click") document.getElementById(`${uid}-p-${g.id}`)?.querySelector<HTMLElement>("[data-main]")?.focus();
                  }}
                  onCloseAutoFocus={afterClose}
                  onEscapeKeyDown={() => { returnFocus.current = true; }}
                  onInteractOutside={(e) => {
                    // A click on this group's own button toggles it; do not also dismiss.
                    if (e.target instanceof Node && buttonFor(g.id)?.contains(e.target)) e.preventDefault();
                  }}
                >
                  {panel(g)}
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
      {small && (
        <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto p-3" onCloseAutoFocus={afterClose}>
            <SheetTitle className="sr-only">{open?.label ?? "Section"}</SheetTitle>
            <SheetDescription className="sr-only">Ready prompts and AI tools for this section.</SheetDescription>
            {open && panel(open)}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function PromptSearch({ groups, busy, reduced, onSend }: { groups: ShownGroup[]; busy: boolean; reduced: boolean; onSend: (t: string) => void }) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const hits = searchPrompts(groups, query);
  const searching = query.trim().length > 0;
  function send(text: string) {
    setQuery("");
    onSend(text);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setQuery("");
    else if (e.key === "ArrowDown" && hits.length) setCursor((cursor + 1) % hits.length);
    else if (e.key === "ArrowUp" && hits.length) setCursor((cursor - 1 + hits.length) % hits.length);
    else if (e.key === "Enter" && hits[cursor] && !busy) send(hits[cursor].text);
    else return;
    e.preventDefault();
  }
  return (
    <div className="mx-auto w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">Search prompts</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={searching && hits.length > 0}
          aria-controls={`${uid}-list`}
          aria-autocomplete="list"
          aria-activedescendant={searching && hits[cursor] ? `${uid}-o-${cursor}` : undefined}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onKeyDown}
          placeholder="Search prompts, e.g. fees or attendance"
          className={`h-11 w-full rounded-full border border-border bg-card pl-9 pr-4 text-sm placeholder:text-muted-foreground ${FOCUS}`}
        />
      </label>
      <p role="status" className="sr-only">{searching ? `${hits.length} ${hits.length === 1 ? "prompt" : "prompts"} found` : ""}</p>
      {searching && (
        <motion.ul
          id={`${uid}-list`}
          role="listbox"
          aria-label="Matching prompts"
          className="mt-2 space-y-0.5 rounded-xl border border-border bg-card p-1"
          {...(reduced ? { initial: false as const } : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, transition: SPRING })}
        >
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No prompts match. Type your question in the message box instead.</li>}
          {hits.map((h, i) => (
            <li
              key={h.text}
              id={`${uid}-o-${i}`}
              role="option"
              aria-selected={i === cursor}
              aria-disabled={busy}
              onClick={() => !busy && send(h.text)}
              onPointerMove={() => setCursor(i)}
              className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-1.5 text-sm ${i === cursor ? "bg-accent outline outline-2 -outline-offset-2 outline-foreground" : ""}`}
            >
              <span>{h.text}</span>
              <span className="text-xs text-muted-foreground">{h.groupLabel}</span>
            </li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
