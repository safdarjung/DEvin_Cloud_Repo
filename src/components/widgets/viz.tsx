"use client";
// Shared interactive / animated data primitives on the kit tokens. CSS keyframes
// (grow-x, ring-fill, beam in globals.css) are `from`-only, so SSR / no-JS /
// reduced-motion renders show the final state; `motion-safe:` gates every
// entrance. All props are serializable so server pages can pass them.
import Link from "next/link";
import { Children, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { AnimatedNumber, LayoutPill, MOTION, type NumberFormat } from "@/components/motion";
import { CHART_COLORS, ChartFrame, chartAxis, chartGrid } from "@/components/chart";
import { trendFull, trendTick, type TrendUnit } from "@/components/widgets/trend-widget";
import { cn } from "cn";

export type VizTone = "default" | "success" | "warning" | "destructive";

export const TONE_TEXT: Record<VizTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};
const TONE_FILL: Record<VizTone, string> = {
  default: "bg-chart-1",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};
const TONE_WORD: Record<VizTone, string> = {
  default: "",
  success: "on track",
  warning: "needs attention",
  destructive: "critical",
};

const BAR_ENTER = "origin-left motion-safe:animate-[grow-x_600ms_var(--ease-out)_both]";
const STAGGER_MS = 40;
const MAX_STAGGER = 8;

/* ------------------------------------------------------------------ Sparkline */

/** Tiny area sparkline (no axes). Used by KpiTile `spark`. Chart is aria-hidden; `summary` is read instead. */
export function Sparkline({ data, summary, className }: { data: number[]; summary: string; className?: string }) {
  const reduce = useReducedMotion();
  if (data.length < 2) return null;
  const rows = data.map((value, i) => ({ i, value }));
  return (
    <div className={cn("mt-2 h-8 min-w-0", className)}>
      <span className="sr-only">{summary}</span>
      <div className="h-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              fill="var(--chart-1)"
              fillOpacity={0.25}
              dot={false}
              activeDot={false}
              isAnimationActive={!reduce}
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- BarList */

export interface BarListItem {
  label: string;
  value: number;
  /** Preformatted value text; otherwise `value` counts up with `format`. */
  display?: string;
  href?: string;
  tone?: VizTone;
}

/** Kit `widget_summary`: label / animated bar / value rows. Bars scale relative to `max` (default: largest value). */
export function BarList({
  items,
  max,
  format = "number",
  ariaLabel,
  className,
}: {
  items: BarListItem[];
  max?: number;
  format?: NumberFormat;
  ariaLabel?: string;
  className?: string;
}) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value));
  return (
    <ul aria-label={ariaLabel} className={cn("-mx-2 space-y-0.5", className)}>
      {items.map((item, i) => {
        const pct = top > 0 ? Math.min(100, Math.max(0, (item.value / top) * 100)) : 0;
        const row = (
          <>
            <span className="truncate text-sm text-foreground">{item.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className={cn("block h-full rounded-full", TONE_FILL[item.tone ?? "default"], BAR_ENTER)}
                style={{ width: `${pct}%`, animationDelay: `${Math.min(i, MAX_STAGGER) * STAGGER_MS}ms` }}
              />
            </span>
            <span className="text-right text-sm font-semibold tabular-nums">
              {item.display ?? <AnimatedNumber value={item.value} format={format} />}
            </span>
          </>
        );
        const grid =
          "grid min-h-10 grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]";
        return (
          <li key={`${item.label}-${i}`}>
            {item.href ? (
              <Link
                href={item.href}
                className={cn(
                  grid,
                  "outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {row}
              </Link>
            ) : (
              <div className={cn(grid, "transition-colors duration-(--duration-fast) hover:bg-accent")}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- RadialGauge */

function gaugeTone(value: number, good: number, warn: number, positiveIsGood: boolean): VizTone {
  if (positiveIsGood) return value >= good ? "success" : value >= warn ? "warning" : "destructive";
  return value <= good ? "success" : value <= warn ? "warning" : "destructive";
}

/**
 * SVG ring gauge. `value` is a percent (0-100). Thresholds: with `positiveIsGood`
 * (default) value >= good is success, >= warn is warning, else destructive; inverted otherwise.
 */
export function RadialGauge({
  value,
  label,
  sublabel,
  size = 88,
  thresholds = { good: 75, warn: 50 },
  positiveIsGood = true,
  className,
}: {
  value: number;
  label: string;
  sublabel?: string;
  size?: number;
  thresholds?: { good: number; warn: number };
  positiveIsGood?: boolean;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const tone = gaugeTone(pct, thresholds.good, thresholds.warn, positiveIsGood);
  const shown = `${+pct.toFixed(1)}%`;
  return (
    <div
      role="img"
      aria-label={`${label}: ${shown}${sublabel ? `, ${sublabel}` : ""} (${TONE_WORD[tone]})`}
      className={cn("flex min-w-0 items-center gap-3", className)}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 36 36" className="size-full -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--muted)" strokeWidth="3.5" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke={`var(--${tone})`}
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - pct}
            className="motion-safe:animate-[ring-fill_800ms_var(--ease-out)_both]"
          />
        </svg>
        <span className={cn("absolute inset-0 grid place-items-center text-base font-semibold tabular-nums", TONE_TEXT[tone])}>
          {shown}
        </span>
      </div>
      <div className="min-w-0" aria-hidden="true">
        <p className="truncate text-sm font-semibold">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- ProgressBar */

export function ProgressBar({
  value,
  max = 100,
  label,
  valueLabel,
  showValue = true,
  tone = "default",
  className,
}: {
  value: number;
  max?: number;
  /** Visible label; also the accessible name. */
  label: string;
  /** Overrides the default "NN%" text (e.g. "₹4.2L of ₹6L"). */
  valueLabel?: string;
  showValue?: boolean;
  tone?: VizTone;
  className?: string;
}) {
  const id = useId();
  const clamped = Math.min(max, Math.max(0, value));
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  const text = valueLabel ?? `${Math.round(pct)}%`;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id} className="min-w-0 truncate">
          {label}
        </span>
        {showValue && <span className="shrink-0 font-semibold tabular-nums">{text}</span>}
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={text}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", TONE_FILL[tone], BAR_ENTER)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- AnimatedList */

/**
 * Activity-feed list (adapted from Magic UI AnimatedList, MIT). First paint uses a
 * CSS stagger; items added later slide in from above and siblings shift via
 * layout. Children need stable `key`s; each is wrapped in an <li>.
 * Reduced motion: no transforms or stagger.
 */
export function AnimatedList({ children, className, ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  const reduce = useReducedMotion();
  const items = Children.toArray(children).map((child, i) => ({ child, key: String((child as { key?: string | null }).key ?? i) }));
  // Items present on first render get the CSS stagger; later ones animate via motion only.
  const [firstKeys] = useState(() => new Set(items.map((it) => it.key)));
  return (
    <ul aria-label={ariaLabel} className={cn("space-y-2", className)}>
      <AnimatePresence initial={false}>
        {items.map(({ child, key }, i) => (
          <motion.li
            key={key}
            layout={reduce ? false : "position"}
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, transition: { duration: MOTION.duration.fast } }}
            transition={{ duration: MOTION.duration.normal, ease: MOTION.ease.out }}
            className={
              firstKeys.has(key)
                ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)"
                : undefined
            }
            style={firstKeys.has(key) && !reduce ? { animationDelay: `${Math.min(i, MAX_STAGGER) * STAGGER_MS}ms` } : undefined}
          >
            {child}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/* ------------------------------------------------------------ InteractiveTrend */

export type TrendRow = { label: string } & Record<string, string | number>;
export interface TrendSeriesDef {
  key: string;
  label: string;
  /** CSS color; defaults to --chart-N by position. */
  color?: string;
}

const DEFAULT_RANGE_LABELS: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", term: "Term", year: "Year" };

function TrendTooltip({ active, payload, label, unit }: TooltipContentProps<TooltipValueType, string | number> & { unit: TrendUnit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
      <p className="mb-1 font-semibold">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums">{trendFull[unit](Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Area/bar trend with range toggles (only the ranges present in `series`), a
 * card tooltip with crosshair, and legend toggles when there is more than one
 * series (adapted from shadcn/ui "Area Chart - Interactive", MIT).
 * Usage: <InteractiveTrend title="Attendance" unit="percent" series={{ "7d": rows7, "30d": rows30 }} keys={[{ key: "present", label: "Present" }]} />
 */
export function InteractiveTrend({
  title,
  series,
  keys,
  unit,
  kind = "area",
  defaultRange,
  rangeLabels,
  heightClass = "h-56",
  className,
}: {
  title: string;
  series: Record<string, TrendRow[]>;
  keys: TrendSeriesDef[];
  unit: TrendUnit;
  kind?: "area" | "bar";
  defaultRange?: string;
  rangeLabels?: Record<string, string>;
  heightClass?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();
  const ranges = Object.keys(series).filter((k) => series[k]?.length);
  const [picked, setPicked] = useState(defaultRange && ranges.includes(defaultRange) ? defaultRange : ranges[0]);
  const range = picked && ranges.includes(picked) ? picked : ranges[0];
  const [hidden, setHidden] = useState<string[]>([]);
  const data = (range ? series[range] : undefined) ?? [];
  const defs = keys.map((k, i) => ({ ...k, color: k.color ?? CHART_COLORS[i % CHART_COLORS.length] }));
  const visible = defs.filter((d) => !hidden.includes(d.key));
  const nameOf = (r: string) => rangeLabels?.[r] ?? DEFAULT_RANGE_LABELS[r] ?? r;

  const first = data[0];
  const last = data.at(-1);
  const summary =
    first && last
      ? `${title}, ${nameOf(range!)}: ` +
        visible.map((d) => `${d.label} from ${trendFull[unit](Number(first[d.key]))} (${first.label}) to ${trendFull[unit](Number(last[d.key]))} (${last.label})`).join("; ") +
        "."
      : `${title}: no data.`;

  const toggle = (key: string) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : visible.length > 1 ? [...h, key] : h));

  const axes = (
    <>
      <CartesianGrid vertical={false} {...chartGrid} />
      <XAxis dataKey="label" minTickGap={24} {...chartAxis} />
      <YAxis
        width={48}
        tickFormatter={trendTick[unit]}
        domain={unit === "percent" ? [(min: number) => Math.max(0, Math.floor(min - 4)), 100] : [0, "auto"]}
        {...chartAxis}
      />
    </>
  );
  const tooltipContent = (p: TooltipContentProps<TooltipValueType, string | number>) => <TrendTooltip {...p} unit={unit} />;
  const anim = { isAnimationActive: !reduce, animationDuration: 600 } as const;

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {(ranges.length > 1 || defs.length > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {ranges.length > 1 ? (
            <div role="group" aria-label={`${title} range`} className="inline-flex border-b-2 border-border">
              {ranges.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === range}
                  onClick={() => setPicked(r)}
                  className={cn(
                    "relative -mb-0.5 inline-flex h-11 items-center px-3 text-sm font-medium outline-none md:h-8",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    r === range ? "font-semibold text-foreground" : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  {nameOf(r)}
                  {r === range && <LayoutPill layoutId={pillId} className="absolute inset-x-0 bottom-0 h-0.5 bg-ring" />}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          {defs.length > 1 && (
            <div role="group" aria-label={`${title} series`} className="flex flex-wrap gap-1">
              {defs.map((d) => {
                const on = !hidden.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(d.key)}
                    className={cn(
                      "inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none md:h-7",
                      "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "text-foreground" : "text-muted-foreground line-through",
                    )}
                  >
                    <span className={cn("size-2.5 rounded-[2px]", !on && "opacity-30")} style={{ background: d.color }} aria-hidden />
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <ChartFrame summary={summary} heightClass={heightClass} empty={data.length === 0} emptyTitle="No trend data yet">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axes}
            <Tooltip content={tooltipContent} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            {defs.map((d) => (
              <Bar key={d.key} dataKey={d.key} name={d.label} fill={d.color} radius={[3, 3, 0, 0]} hide={hidden.includes(d.key)} {...anim} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axes}
            <Tooltip content={tooltipContent} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
            {defs.map((d) => (
              <Area
                key={d.key}
                type="monotone"
                dataKey={d.key}
                name={d.label}
                stroke={d.color}
                strokeWidth={2}
                fill={d.color}
                fillOpacity={defs.length > 1 ? 0.12 : 0.25}
                hide={hidden.includes(d.key)}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                {...anim}
              />
            ))}
          </AreaChart>
        )}
      </ChartFrame>
    </div>
  );
}

/* ----------------------------------------------------------------- BorderBeam */

/**
 * Teal light travelling the card border (adapted from Magic UI BorderBeam, MIT;
 * CSS offset-path instead of JS). AI cards ONLY. Parent must be `relative`.
 * Hidden under reduced motion.
 */
export function BorderBeam({ size = 64, duration = 8, className }: { size?: number; duration?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent motion-reduce:hidden",
        "[mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]",
        className,
      )}
    >
      <span
        className="absolute aspect-square bg-linear-to-l from-ring via-ring/50 to-transparent [offset-anchor:90%_50%] [offset-path:rect(0_auto_auto_0_round_var(--radius))] motion-safe:animate-[beam_8s_linear_infinite]"
        style={{ width: size, animationDuration: `${duration}s` }}
      />
    </span>
  );
}

/* -------------------------------------------------------------- SpotlightCard */

/**
 * Opt-in wrapper: a faint radial highlight follows the pointer (adapted from
 * Aceternity "Card Spotlight", MIT). Mouse/pen only; no effect on touch.
 */
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
  }
  return (
    <div ref={ref} onPointerMove={onMove} className={cn("group/spot relative isolate", className)}>
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-(--duration-normal) [@media(hover:hover)]:group-hover/spot:opacity-100"
        style={
          {
            background:
              "radial-gradient(240px circle at var(--spot-x, 50%) var(--spot-y, 50%), color-mix(in oklab, var(--ring) 6%, transparent), transparent 70%)",
          } as CSSProperties
        }
      />
    </div>
  );
}
