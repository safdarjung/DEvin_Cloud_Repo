"use client";

// The current mode's features as dots on the orb: one real button (or page link) per
// feature, in its section's colour with the section's icon. OrbBody's frame loop
// places them over the whole sphere and reads two things from here: which dot is hot
// (`data-hot`: hovered, keyboard-focused or tapped) and which are dimmed (`data-dim`:
// a section or a search is lit and this dot is not in it). The hot dot's name and what
// a click does show in one label the loop keeps next to it. Mouse: hover shows, click
// runs. Touch: the first tap shows, the second runs. Keys: one Tab stop, arrows move.
// A few dots (they all sit on the front) carry their names under them.
// OrbLegend names the colours: a section's pill lights its dots.
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { GROUP_ICONS, blocked } from "./OrbGroups";
import { FULL_SPHERE_FROM } from "./orb-layout";
import { featureEffect, modeInfo, sectionLabel, type OrbFeature, type OrbGroup, type OrbMode } from "./orb-modes";

/** Dots on the sphere at most; the rest stay reachable through search. */
export const DOT_CAP = 84;

interface Props {
  mode: OrbMode;
  groups: readonly OrbGroup[];
  /** Feature keys that stay lit (the others dim); null: all lit. */
  lit: ReadonlySet<string> | null;
  /** Changes whenever the lit set does: OrbBody turns the lit dots to the front. */
  litKey: string;
  hasDraft: boolean;
  busy: boolean;
  starting: string | null;
  onRun: (f: OrbFeature) => void;
  /** A dot became hot: the orb answers with a small pulse. */
  onHot: () => void;
}

const DOT =
  "group pointer-events-auto absolute left-1/2 top-1/2 grid size-(--dot) cursor-pointer place-items-center rounded-full opacity-0 outline-none transition-[filter] duration-200 after:absolute after:-inset-1 after:rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-dim:[filter:grayscale(0.9)_opacity(0.28)] disabled:cursor-default";

function OrbDotsImpl({ mode, groups, lit, litKey, hasDraft, busy, starting, onRun, onHot }: Props) {
  const dots = groups.flatMap((g) => g.features.map((f) => ({ f, hue: g.hue }))).slice(0, DOT_CAP);
  // Keyed by mode, so a mode change drops whatever dot was hot.
  const [hotKey, setHotKey] = useState<string | null>(null);
  const hot = hotKey?.startsWith(`${mode}:`) ? hotKey.slice(mode.length + 1) : null;
  const [rove, setRove] = useState(0);
  const touch = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const hotDot = dots.find((d) => d.f.key === hot);
  const named = dots.length < FULL_SPHERE_FROM;

  function setHot(key: string | null) {
    setHotKey(key && `${mode}:${key}`);
    if (key && key !== hot) onHot();
  }

  // A tapped dot stays hot until a tap lands somewhere else.
  useEffect(() => {
    if (!hot) return;
    const away = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && !(e.target instanceof Element && e.target.closest("[data-node]"))) setHotKey(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hot]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[data-node]") ?? [])];
    const at = items.findIndex((el) => el === document.activeElement);
    if (at < 0) return;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  }

  return (
    <div
      ref={root}
      data-dots
      data-lit={litKey}
      role="group"
      aria-label={`${modeInfo(mode).label}: everything the orb can do here. Arrow keys move between them.`}
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute inset-0"
    >
      {dots.map(({ f, hue }, i) => {
        const Icon = GROUP_ICONS[f.groupId];
        const effect = f.kind === "task" && starting === f.task ? "Opening…" : featureEffect(f, hasDraft);
        const page = f.kind === "open" && Boolean(f.href);
        const common = {
          "data-node": i,
          "data-hot": hot === f.key ? "" : undefined,
          "data-dim": lit && !lit.has(f.key) ? "" : undefined,
          "aria-label": `${f.label}: ${effect} (${sectionLabel(f.groupId)})`,
          tabIndex: i === Math.min(rove, dots.length - 1) ? 0 : -1,
          onFocus: (e: React.FocusEvent<HTMLElement>) => {
            setRove(i);
            if (e.currentTarget.matches(":focus-visible")) setHot(f.key);
          },
          onBlur: () => hot === f.key && !touch.current && setHotKey(null),
          onPointerDown: (e: React.PointerEvent) => {
            touch.current = e.pointerType !== "mouse";
          },
          onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setHot(f.key),
          onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && hot === f.key && setHotKey(null),
          className: DOT,
          // A page link is a hollow dot; an AI action is a filled, lit one.
          style: page
            ? { background: "var(--card)", boxShadow: `inset 0 0 0 2px ${hue}, 0 6px 16px -8px ${hue}`, color: hue }
            : {
                background: `radial-gradient(circle at 32% 26%, color-mix(in oklab, ${hue} 45%, white), ${hue} 62%, color-mix(in oklab, ${hue} 70%, black))`,
                boxShadow: `0 0 0 1.5px rgb(255 255 255 / 0.55), 0 8px 20px -8px ${hue}, 0 0 18px -4px ${hue}`,
                color: "white",
              },
        };
        // Touch has no hover: the first tap only shows what the dot is.
        const firstTap = () => touch.current && hot !== f.key;
        const face = (
          <>
            <Icon className="size-[46%]" aria-hidden />
            {named && (
              // The hot dot's label says the same and more: its own name steps aside.
              <span aria-hidden className="pointer-events-none absolute left-1/2 top-full mt-1.5 line-clamp-2 w-max max-w-28 -translate-x-1/2 rounded-xl border border-border bg-card/90 px-2 py-0.5 text-center text-xs font-medium leading-tight text-foreground shadow-xs transition-opacity group-data-hot:opacity-0">
                {f.label}
              </span>
            )}
          </>
        );
        return page ? (
          <Link
            key={f.key}
            href={f.href as string}
            {...common}
            onClick={(e) => {
              if (!firstTap()) return;
              e.preventDefault();
              setHot(f.key);
            }}
          >
            {face}
          </Link>
        ) : (
          <button
            key={f.key}
            type="button"
            {...common}
            // Not `disabled`: a blocked dot still shows its name on hover and focus.
            aria-disabled={blocked(f, busy, hasDraft, starting)}
            onClick={() => {
              if (firstTap()) return setHot(f.key);
              if (!blocked(f, busy, hasDraft, starting)) onRun(f);
            }}
          >
            {face}
          </button>
        );
      })}
      {/* The hot dot's label: OrbBody's loop keeps it beside the dot and fades it. Dots carry the same text as their accessible name. */}
      <div data-orb-label aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-50 w-max max-w-60 opacity-0">
        {hotDot && (
          <div className="rounded-2xl border bg-card/95 px-3 py-1.5 text-center leading-tight shadow-[0_18px_44px_-18px_rgb(0_0_0/0.6)] backdrop-blur" style={{ borderColor: `color-mix(in oklab, ${hotDot.hue} 55%, var(--border))` }}>
            <p className="text-sm font-semibold text-foreground">{hotDot.f.label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {sectionLabel(hotDot.f.groupId)} · {hotDot.f.kind === "task" && starting === hotDot.f.task ? "Opening…" : featureEffect(hotDot.f, hasDraft)}
              <span className="hidden pointer-coarse:inline"> · tap again</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export const OrbDots = memo(OrbDotsImpl);

/**
 * Names the colours on the orb: a section's pill lights its dots (hover peeks, a click keeps them lit).
 * A column beside the orb on wide screens (OrbView places it); one scrolling line under the tabs otherwise.
 */
export function OrbLegend({ groups, pinned, onPin, onPeek }: {
  groups: readonly OrbGroup[];
  pinned: string | null;
  onPin: (id: string | null) => void;
  onPeek: (id: string | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sections on the orb: choose one to light up its dots"
      className="relative mx-auto flex w-fit max-w-full items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] xl:absolute xl:left-0 xl:top-1/2 xl:max-h-full xl:-translate-y-1/2 xl:flex-col xl:items-stretch xl:overflow-y-auto"
    >
      {groups.map((g) => {
        const Icon = GROUP_ICONS[g.id];
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={pinned === g.id}
            onClick={() => onPin(pinned === g.id ? null : g.id)}
            onPointerEnter={(e) => e.pointerType === "mouse" && onPeek(g.id)}
            onPointerLeave={() => onPeek(null)}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-1 pr-2.5 text-xs font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground aria-pressed:bg-accent pointer-coarse:min-h-11"
          >
            <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: g.hue }}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="flex-1 text-left">{g.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {g.features.length}
              <span className="sr-only"> {g.features.length === 1 ? "option" : "options"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
