"use client";

// The current mode's sections: one real button per group (name, icon, count) that
// opens a small popover (a bottom sheet on phones) with that group's features, and a
// search across the features of every mode. Each feature says what a click does
// (asks now, starts a draft, opens a card to approve, opens a page). The buttons are
// glassy chips riding the orb ("sphere": OrbBody's frame loop places them, or a flat
// cluster on its front without WebGL / with reduced motion), or a row under a small
// orb. Radix handles focus-in, Esc, return focus and outside click; this file adds
// hover intent (row), arrow keys, the row's re-arranging motion on mode change and a
// touch swipe between modes.
import Link from "next/link";
import { memo, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight, Banknote, BookOpen, Building2, CalendarCheck, CalendarClock, ClipboardCheck, ClipboardList, Globe, GraduationCap,
  History, Lightbulb, Megaphone, NotebookPen, Pencil, Search, Sparkles, Trophy, Users,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { flickDelta } from "./orb-layout";
import { RECENT_HUE, featureEffect, modeInfo, searchFeatures, sectionLabel, type OrbFeature, type OrbGroup, type OrbMode } from "./orb-modes";

type GroupIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const ICONS: Record<OrbGroup["id"], GroupIcon> = {
  attendance: CalendarCheck, exams: GraduationCap, teaching: BookOpen, study: NotebookPen, finance: Banknote,
  admissions: ClipboardList, timetable: CalendarClock, people: Users, insights: Lightbulb, calendar: Megaphone,
  clubs: Trophy, operations: Building2, website: Globe, more: Sparkles, recent: History,
};

interface Props {
  mode: OrbMode;
  groups: readonly OrbGroup[];
  /** "sphere": the groups ride the orb (rendered inside OrbBody's stage); "row": buttons under a small orb. */
  layout: "sphere" | "row";
  /** Sphere only: OrbBody's frame loop places the groups; false lays them out flat on the orb's front. */
  spin: boolean;
  /** The message box has text: a task click sends it with the task instead of opening an empty card. */
  hasDraft: boolean;
  busy: boolean;
  /** The task whose card is being opened. */
  starting: string | null;
  reduced: boolean;
  /** Which way the last mode change went, so new groups slide in from that side. */
  direction: number;
  onRun: (f: OrbFeature) => void;
  onEdit: (text: string) => void;
  /** Sphere only: few groups, so their features are the chips. */
  featureChips: boolean;
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
const SWIPE_RATIO = 1.5;
const SPRING = { type: "spring", stiffness: 420, damping: 24, mass: 0.8 } as const;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW_BTN = `min-h-11 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60 ${FOCUS}`;
// A glass chip on the orb: translucent card with a top highlight; 52 px tall on touch so a pickable chip (scale ≥ 0.85) stays ≥ 44 px.
const CHIP =
  "pointer-events-auto flex min-h-11 cursor-pointer items-center gap-2 border border-white/70 bg-card/80 bg-linear-to-b from-white/60 to-white/0 py-1 pl-1 pr-3 text-sm font-semibold tracking-tight text-foreground shadow-[0_10px_28px_-14px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.85)] pointer-coarse:min-h-13 pointer-coarse:gap-1.5 pointer-coarse:text-[13px] dark:border-white/15 dark:bg-card/75 dark:from-white/12 dark:shadow-[0_12px_30px_-12px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.2)] aria-expanded:border-foreground aria-expanded:ring-2 aria-expanded:ring-foreground";

// Shorter names for a crowded phone sphere (the full name stays the accessible name).
const SHORT: Partial<Record<OrbGroup["id"], string>> = { calendar: "Notices", clubs: "Clubs", operations: "Operations" };
/** Feature chips shown on the sphere at most (the rest: a "More" chip and search). */
const FEATURE_CAP = 10;

/** Light on a chip riding the sphere: a sheen that grows toward the front and the front chip's ring (opacity set by OrbBody's loop). */
function ChipLight({ hue }: { hue: string }) {
  return (
    <>
      <span
        data-sheen
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(120%_100%_at_30%_0%,rgb(255_255_255/0.8),transparent_65%)] opacity-0 dark:bg-[radial-gradient(120%_100%_at_30%_0%,rgb(255_255_255/0.22),transparent_65%)]"
      />
      <span data-front aria-hidden className="pointer-events-none absolute -inset-[3px] rounded-[inherit] opacity-0" style={{ boxShadow: `0 0 0 2px ${hue}, 0 0 26px -2px ${hue}` }} />
    </>
  );
}

/** A group's icon, name and feature count (the count also read out); `dense`: short name and no count pill on a phone. */
function GroupFace({ g, round, dense = false }: { g: OrbGroup; round: boolean; dense?: boolean }) {
  const short = dense ? SHORT[g.id] : undefined;
  const Icon = ICONS[g.id];
  return (
    <>
      <span
        className={`relative grid shrink-0 place-items-center ${round ? "size-8 rounded-full pointer-coarse:size-9" : "size-7 rounded-lg"}`}
        style={{ background: `color-mix(in srgb, ${g.hue} ${round ? 26 : 18}%, transparent)` }}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="relative min-w-0 flex-1 leading-tight">
        {short ? (
          <>
            <span className="max-sm:sr-only">{g.label}</span>
            <span aria-hidden className="sm:hidden">{short}</span>
          </>
        ) : (
          g.label
        )}
      </span>
      <span className={`relative shrink-0 rounded-full bg-muted ${dense ? "max-sm:sr-only" : ""} px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground`}>
        {g.features.length}
        <span className="sr-only"> {g.features.length === 1 ? "option" : "options"}</span>
      </span>
    </>
  );
}

/** Is the feature runnable right now? Questions and drafts wait for the current answer; a task waits only when it would send. */
const blocked = (f: OrbFeature, busy: boolean, hasDraft: boolean, starting: string | null) =>
  f.kind === "open" ? false : f.kind === "task" ? starting === f.task || (busy && hasDraft) : busy || !f.prompt;

function Effect({ f, hasDraft, starting }: { f: OrbFeature; hasDraft: boolean; starting: string | null }) {
  const Icon = f.kind === "open" ? ArrowUpRight : f.kind === "task" ? ClipboardCheck : Sparkles;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      {f.kind === "task" && starting === f.task ? "Opening…" : featureEffect(f, hasDraft)}
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

function FeatureRow({ f, hasDraft, busy, starting, onRun, onEdit }: {
  f: OrbFeature; hasDraft: boolean; busy: boolean; starting: string | null; onRun: (f: OrbFeature) => void; onEdit: (t: string) => void;
}) {
  if (f.kind === "open" && f.href) {
    return (
      <Link href={f.href} data-main className={`${ROW_BTN} flex items-center justify-between gap-2`}>
        <span>{f.label}</span>
        <Effect f={f} hasDraft={hasDraft} starting={starting} />
      </Link>
    );
  }
  const plainQuestion = f.kind === "ask" && f.mode === "ask";
  return (
    <>
      <button
        type="button"
        data-main
        disabled={blocked(f, busy, hasDraft, starting)}
        onClick={() => onRun(f)}
        className={`${ROW_BTN} flex flex-1 items-center justify-between gap-2`}
      >
        <span>{f.label}</span>
        {!plainQuestion && <Effect f={f} hasDraft={hasDraft} starting={starting} />}
      </button>
      {plainQuestion && f.prompt && (
        <button
          type="button"
          data-edit
          disabled={busy}
          onClick={() => onEdit(f.prompt as string)}
          aria-label={`Edit before sending: ${f.prompt}`}
          title="Put in the message box to edit"
          className={`grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60 ${FOCUS}`}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
      )}
    </>
  );
}

const PART_TITLE: Record<"ask" | "task" | "tool", string> = { ask: "", task: "Tasks · you approve each card", tool: "AI tools" };

function Panel({ group, titleId, hasDraft, busy, starting, reduced, onChoose, onEdit }: {
  group: OrbGroup; titleId: string; hasDraft: boolean; busy: boolean; starting: string | null; reduced: boolean;
  onChoose: (f: OrbFeature) => void; onEdit: (t: string) => void;
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
  const parts = (["ask", "task", "tool"] as const)
    .map((part) => ({
      part,
      list: group.features.filter((f) => (part === "task" ? f.kind === "task" : part === "ask" ? f.kind === "ask" && f.mode === "ask" : f.kind !== "task" && !(f.kind === "ask" && f.mode === "ask"))),
    }))
    .filter((p) => p.list.length > 0);
  let n = 0;
  const item = () => (reduced ? { initial: false as const } : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING, delay: 0.04 + 0.03 * n++ } });
  return (
    <motion.div
      ref={root}
      onKeyDown={onKeyDown}
      // Grows out of the group's button (Radix sets the origin on the side facing it).
      {...(reduced ? { initial: false as const } : { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: SPRING })}
      style={{ transformOrigin: "var(--radix-popover-content-transform-origin, 50% 0)" }}
    >
      <h3 id={titleId} className="flex items-center gap-2 px-1 text-sm font-semibold">
        <span className="size-2.5 rounded-full" style={{ background: group.hue }} aria-hidden />
        {group.label}
      </h3>
      {parts.map(({ part, list }, i) => (
        <div key={part}>
          {PART_TITLE[part] && (parts.length > 1 || part === "task") && (
            <h4 className={`${i === 0 ? "mt-2" : "mt-3"} px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground`}>{PART_TITLE[part]}</h4>
          )}
          <ul aria-label={`${part === "ask" ? "Ready questions" : PART_TITLE[part]} for ${group.label}`} className="mt-1 space-y-0.5">
            {list.map((f) => (
              <motion.li key={f.key} data-row className="flex items-stretch gap-0.5" {...item()}>
                <FeatureRow f={f} hasDraft={hasDraft} busy={busy} starting={starting} onRun={onChoose} onEdit={onEdit} />
              </motion.li>
            ))}
          </ul>
        </div>
      ))}
    </motion.div>
  );
}

function OrbGroupsImpl({ mode, groups, layout, spin, featureChips, hasDraft, busy, starting, reduced, direction, onRun, onEdit, onActive }: Props) {
  const sphere = layout === "sphere";
  // Few groups: their features ride the sphere (up to the cap; a "More" chip opens the rest).
  const allFeatures = sphere && featureChips ? groups.flatMap((g) => g.features) : [];
  const shown = allFeatures.length > FEATURE_CAP ? allFeatures.slice(0, FEATURE_CAP - 1) : allFeatures;
  const chipGroups: OrbGroup[] =
    sphere && featureChips
      ? allFeatures.length > shown.length
        ? [{ id: "more", label: "More", hue: RECENT_HUE, features: allFeatures.slice(shown.length) }]
        : []
      : [...groups];
  const chipCount = shown.length + chipGroups.length;
  const dense = sphere && chipCount > 8;
  const hueOf = (id: OrbFeature["groupId"]) => groups.find((g) => g.id === id)?.hue ?? RECENT_HUE;
  const uid = useId();
  const small = useSyncExternalStore(subscribeSmall, () => window.matchMedia(SMALL).matches, () => false);
  // Keyed by mode, so a mode change closes whatever group was open.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openId = openKey?.startsWith(`${mode}:`) ? openKey.slice(mode.length + 1) : null;
  const setOpenId = (id: string | null) => setOpenKey(id && `${mode}:${id}`);
  const [rove, setRove] = useState(0);
  const via = useRef<"hover" | "click">("click");
  const returnFocus = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const open = chipGroups.find((g) => g.id === openId) ?? null;

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
  function choose(f: OrbFeature) {
    close(true);
    onRun(f);
  }
  function edit(text: string) {
    close(false);
    onEdit(text);
  }
  function afterClose(e: Event) {
    e.preventDefault();
    if (returnFocus.current) {
      // The group that was open holds the roving stop (opening focused it).
      bar.current?.querySelectorAll<HTMLElement>("[data-group]")[Math.min(rove, chipCount - 1)]?.focus();
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

  const panel = (g: OrbGroup) => (
    <Panel group={g} titleId={`${uid}-t-${g.id}`} hasDraft={hasDraft} busy={busy} starting={starting} reduced={reduced} onChoose={choose} onEdit={edit} />
  );

  return (
    <>
      <div
        ref={bar}
        role="group"
        aria-label={`${modeInfo(mode).label} sections`}
        onKeyDown={onBarKey}
        className={
          sphere
            ? spin
              ? "pointer-events-none absolute inset-0"
              : "pointer-events-none absolute inset-[8%] flex flex-wrap content-center items-center justify-center gap-2"
            : "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center"
        }
      >
        {shown.map((f, i) => {
          const Icon = ICONS[f.groupId];
          const KindIcon = f.kind === "open" ? ArrowUpRight : f.kind === "task" ? ClipboardCheck : Sparkles;
          const hue = hueOf(f.groupId);
          const chip = {
            "data-node": i,
            "data-group": f.key,
            onFocus: () => setRove(i),
            className: `${CHIP} rounded-2xl text-left disabled:[&>*]:opacity-60 ${spin ? "absolute left-1/2 top-1/2 opacity-0" : "relative"} ${FOCUS}`,
          };
          const face = (
            <>
              {spin && <ChipLight hue={hue} />}
              <span className="relative grid size-8 shrink-0 place-items-center rounded-full pointer-coarse:size-9" style={{ background: `color-mix(in srgb, ${hue} 26%, transparent)` }}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className={`relative line-clamp-2 min-w-0 max-w-[11rem] leading-tight ${dense ? "max-sm:max-w-[7.5rem]" : ""}`}>{f.label}</span>
              <KindIcon className="relative size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">: {f.kind === "task" && starting === f.task ? "Opening…" : featureEffect(f, hasDraft)}</span>
            </>
          );
          // The same as the feature's row in its group popover: a page link, or a click that asks, drafts or opens a card.
          return f.kind === "open" && f.href ? (
            <Link key={f.key} href={f.href} {...chip}>
              {face}
            </Link>
          ) : (
            <button key={f.key} type="button" disabled={blocked(f, busy, hasDraft, starting)} onClick={() => onRun(f)} {...chip}>
              {face}
            </button>
          );
        })}
        {chipGroups.map((g, j) => {
          const i = shown.length + j;
          const isOpen = openId === g.id;
          const toggle = () => (isOpen && via.current === "click" ? close(true) : show(g.id, "click"));
          const button = sphere ? (
            // Every chip is a Tab stop (stable order); OrbBody turns a keyboard-focused one to the front.
            <button
              key={g.id}
              type="button"
              data-group={g.id}
              data-node={i}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
              aria-controls={`${uid}-p-${g.id}`}
              onFocus={() => setRove(i)}
              onClick={toggle}
              className={`${CHIP} whitespace-nowrap rounded-full ${spin ? "absolute left-1/2 top-1/2 opacity-0" : "relative"} ${FOCUS}`}
            >
              {spin && <ChipLight hue={g.hue} />}
              <GroupFace g={g} round dense={dense} />
            </button>
          ) : (
            <motion.button
              key={g.id}
              type="button"
              data-group={g.id}
              layout={reduced ? false : "position"}
              layoutDependency={mode}
              initial={reduced ? false : { opacity: 0, scale: 0.85, x: 28 * direction }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ ...SPRING, delay: reduced ? 0 : Math.min(i, 8) * 0.025 }}
              tabIndex={i === Math.min(rove, chipCount - 1) ? 0 : -1}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
              aria-controls={`${uid}-p-${g.id}`}
              onFocus={() => setRove(i)}
              onClick={toggle}
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse" || small) return;
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => show(g.id, "hover"), HOVER_INTENT_MS);
              }}
              onPointerLeave={() => hoverTimer.current && clearTimeout(hoverTimer.current)}
              whileHover={reduced ? undefined : { y: -3 }}
              whileFocus={reduced ? undefined : { y: -3 }}
              className={`flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm font-medium shadow-xs hover:bg-accent aria-expanded:border-2 aria-expanded:border-foreground aria-expanded:bg-accent ${FOCUS}`}
            >
              <GroupFace g={g} round={false} />
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
                // Row: start-aligned (a centred popover under the first group in a row slid over the sidebar). Sphere: centred under the chip.
                align={sphere ? "center" : "start"}
                sideOffset={10}
                collisionPadding={12}
                className="max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-2 data-open:animate-none data-closed:animate-none"
                onOpenAutoFocus={(e) => {
                  // Hover is a peek: keep focus where it is. Click/keys move focus to the first row.
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
            <SheetDescription className="sr-only">What the orb can do for this section.</SheetDescription>
            {open && panel(open)}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

export const OrbGroups = memo(OrbGroupsImpl);

/** Touch: a horizontal swipe over this area moves between modes (vertical still scrolls: pan-y) and never also presses the button under the finger. */
export function useModeSwipe(onSwipe: (delta: number) => void) {
  const swipe = useRef<{ x: number; y: number; t: number; swiped: boolean } | null>(null);
  return {
    onPointerDown(e: React.PointerEvent) {
      if (e.pointerType === "touch") swipe.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, swiped: false };
    },
    onPointerUp(e: React.PointerEvent) {
      const s = swipe.current;
      if (!s || e.pointerType !== "touch") return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return void (swipe.current = null);
      const delta = flickDelta(dx, (dx / Math.max(1, e.timeStamp - s.t)) * 1000);
      if (delta === 0) return void (swipe.current = null);
      s.swiped = true;
      onSwipe(Math.sign(delta));
    },
    onPointerCancel() {
      swipe.current = null;
    },
    onClickCapture(e: React.MouseEvent) {
      if (swipe.current?.swiped) {
        e.preventDefault();
        e.stopPropagation();
      }
      swipe.current = null;
    },
    style: { touchAction: "pan-y" } as const,
  };
}

export function FeatureSearch({ features, hasDraft, busy, starting, reduced, onRun }: {
  features: readonly OrbFeature[]; hasDraft: boolean; busy: boolean; starting: string | null; reduced: boolean; onRun: (f: OrbFeature) => void;
}) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const hits = searchFeatures(features, query);
  const searching = query.trim().length > 0;
  function run(f: OrbFeature) {
    if (blocked(f, busy, hasDraft, starting)) return;
    setQuery("");
    onRun(f);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setQuery("");
    else if (e.key === "ArrowDown" && hits.length) setCursor((cursor + 1) % hits.length);
    else if (e.key === "ArrowUp" && hits.length) setCursor((cursor - 1 + hits.length) % hits.length);
    else if (e.key === "Enter" && hits[cursor]) run(hits[cursor]);
    else return;
    e.preventDefault();
  }
  return (
    <div className="mx-auto w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">Search everything the orb can do</span>
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
          placeholder="Search all modes, e.g. fees, attendance, leave"
          className={`h-11 w-full rounded-full border border-border bg-card pl-9 pr-4 text-sm placeholder:text-muted-foreground ${FOCUS}`}
        />
      </label>
      <p role="status" className="sr-only">{searching ? `${hits.length} ${hits.length === 1 ? "match" : "matches"} found` : ""}</p>
      {searching && (
        <motion.ul
          id={`${uid}-list`}
          role="listbox"
          aria-label="Matches"
          className="mt-2 space-y-0.5 rounded-xl border border-border bg-card p-1"
          {...(reduced ? { initial: false as const } : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, transition: SPRING })}
        >
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing matches. Type your request in the message box instead.</li>}
          {hits.map((f, i) => (
            <li
              key={f.key}
              id={`${uid}-o-${i}`}
              role="option"
              aria-selected={i === cursor}
              aria-disabled={blocked(f, busy, hasDraft, starting)}
              onClick={() => run(f)}
              onPointerMove={() => setCursor(i)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm ${i === cursor ? "bg-accent outline outline-2 -outline-offset-2 outline-foreground" : ""}`}
            >
              <span className="flex min-w-0 flex-col">
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">{modeInfo(f.mode).label} · {sectionLabel(f.groupId)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{featureEffect(f, hasDraft)}</span>
            </li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
