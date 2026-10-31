// Dashboard "home" building blocks (server-renderable): hero, KPI tiles with
// sparklines, bar chart card, promo banner, activity feed, quick-action grid,
// schedule list. Pure display — callers pass real data in.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ArrowDownRight, CalendarClock, ChevronRight, History, Zap } from "lucide-react";
import { AnimatedNumber, FadeIn, Stagger, StaggerItem, type NumberFormat } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { cn } from "cn";

export type Tone = "primary" | "info" | "success" | "warning" | "destructive";

const TONE: Record<Tone, { badge: string; text: string }> = {
  primary: { badge: "bg-primary/10 text-primary", text: "text-primary" },
  info: { badge: "bg-info/15 text-info", text: "text-info" },
  success: { badge: "bg-success/15 text-success", text: "text-success" },
  warning: { badge: "bg-warning/20 text-warning", text: "text-warning" },
  destructive: { badge: "bg-destructive/10 text-destructive", text: "text-destructive" },
};

// ---------------------------------------------------------------- hero

export interface HeroChip {
  key: string;
  icon: ReactNode;
  label: string;
  href?: string;
  tone?: Tone;
}

function CampusArt() {
  return (
    <svg viewBox="0 0 460 176" role="img" aria-label="Campus illustration" className="size-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9d8ff" />
          <stop offset="1" stopColor="#eef3ff" />
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c8cf5" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="460" height="176" fill="url(#sky)" />
      <circle cx="372" cy="40" r="22" fill="#fff" opacity=".85" />
      <rect x="0" y="136" width="460" height="40" fill="#cfe9dc" />
      <rect x="40" y="70" width="120" height="70" rx="6" fill="url(#glass)" opacity=".92" />
      <rect x="150" y="48" width="150" height="92" rx="6" fill="url(#glass)" />
      <rect x="290" y="82" width="110" height="58" rx="6" fill="url(#glass)" opacity=".85" />
      {[160, 190, 220, 250, 270].map((x) => (
        <rect key={x} x={x} y="62" width="14" height="22" rx="2" fill="#fff" opacity=".55" />
      ))}
      {[160, 190, 220, 250, 270].map((x) => (
        <rect key={`b${x}`} x={x} y="96" width="14" height="22" rx="2" fill="#fff" opacity=".4" />
      ))}
      <rect x="215" y="112" width="26" height="28" rx="3" fill="#fff" opacity=".7" />
      <path d="M0 150 Q 120 138 230 150 T 460 146 V176 H0Z" fill="#b9dccb" opacity=".8" />
    </svg>
  );
}

export function HomeHero({
  eyebrow,
  updated,
  title,
  description,
  chips,
}: {
  eyebrow: string;
  updated: string;
  title: string;
  description: string;
  chips: HeroChip[];
}) {
  return (
    <FadeIn as="section" className="relative overflow-hidden rounded-2xl bg-card shadow-[0_1px_12px_rgb(15_23_42/0.06)] ring-1 ring-foreground/5 dark:shadow-none dark:ring-foreground/10">
      <div className="flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center">
        <div className="z-10 flex max-w-xl flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-success uppercase">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {eyebrow}
            </span>
            <span className="text-xs text-muted-foreground">{updated}</span>
          </div>
          <h1 className="text-3xl leading-tight font-bold tracking-[-0.025em] text-balance sm:text-4xl">{title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          {chips.length > 0 && (
            <Stagger className="flex flex-wrap gap-2 pt-1.5">
              {chips.map((c) => {
                const body = (
                  <>
                    <span className={cn("[&_svg]:size-4", TONE[c.tone ?? "primary"].text)}>{c.icon}</span>
                    <span className="text-xs font-semibold">{c.label}</span>
                    {c.href && <ArrowRight className="size-3 text-muted-foreground" aria-hidden />}
                  </>
                );
                const cls = "inline-flex min-h-8 items-center gap-2 rounded-xl bg-muted px-3";
                return (
                  <StaggerItem key={c.key}>
                    {c.href ? (
                      <Link href={c.href} className={cn(cls, "outline-none transition-[background-color,transform] duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]")}>
                        {body}
                      </Link>
                    ) : (
                      <span className={cls}>{body}</span>
                    )}
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
        </div>
        <div className="h-36 w-full shrink-0 overflow-hidden rounded-xl lg:h-40 lg:w-80 xl:w-[26rem]" aria-hidden>
          <CampusArt />
        </div>
      </div>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- KPI tile

function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 36 - ((v - min) / span) * 32] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn("h-9 w-full overflow-visible", TONE[tone].text)} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HomeKpi({
  icon,
  tone,
  label,
  value,
  animateTo,
  format,
  delta,
  spark,
  footLeft,
  footRight,
  href,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
  animateTo?: number;
  format?: NumberFormat;
  /** Percent change; shown as a pill only when real/fixture data supplies it. */
  delta?: number;
  spark?: number[];
  footLeft?: string;
  footRight?: string;
  href?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const DeltaIcon = up ? ArrowUpRight : ArrowDownRight;
  const inner = (
    <Card className="h-full gap-3 p-0 transition-[box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(79_70_229/0.10)] dark:hover:shadow-none">
      <div className="flex h-full flex-col justify-between gap-3 p-4">
        <div className="flex items-start justify-between">
          <span className={cn("flex size-10 items-center justify-center rounded-xl [&_svg]:size-5", TONE[tone].badge)}>{icon}</span>
          {delta !== undefined && (
            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", up ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
              <DeltaIcon className="size-3" aria-hidden />
              {Math.abs(delta).toFixed(1)}%
              <span className="sr-only">{up ? " up" : " down"}</span>
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-[1.625rem] leading-8 font-bold tracking-[-0.03em] tabular-nums">
            {animateTo !== undefined ? <AnimatedNumber value={animateTo} format={format} /> : value}
          </p>
        </div>
        {spark && <Sparkline values={spark} tone={tone} />}
        {(footLeft || footRight) && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{footLeft}</span>
            <span className={cn("shrink-0 font-semibold", TONE[tone].text)}>{footRight}</span>
          </div>
        )}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ---------------------------------------------------------------- bar chart card

export function HomePerformance({
  title,
  description,
  icon,
  bars,
  footer,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  /** Percent bars (axis 80–100%), oldest first; the last one is highlighted as "now". */
  bars?: { label: string; value: number }[];
  footer?: string;
  /** Real-data fallback rendered instead of `bars`. */
  children?: ReactNode;
}) {
  return (
    <FadeIn>
      <Card className="gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-primary [&_svg]:size-5">{icon}</span>
          <div>
            <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {bars ? (
          <>
            <p className="sr-only">{bars.map((b) => `${b.label} ${b.value}%`).join(", ")}</p>
            <div className="flex h-52 items-end gap-2 px-1 sm:px-4" aria-hidden>
              <div className="flex h-full flex-col justify-between py-1 pr-2 text-right text-[11px] text-muted-foreground select-none">
                {["100%", "95%", "90%", "85%", "80%"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              {bars.map((b, i) => {
                const now = i === bars.length - 1;
                return (
                  <div key={b.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                    <div
                      className={cn(
                        "relative w-full max-w-12 rounded-t-xl transition-[filter,background-color] duration-(--duration-normal)",
                        now ? "bg-gradient-to-t from-primary to-primary/70 shadow-md" : "bg-gradient-to-t from-primary/20 to-primary/60 group-hover:to-primary",
                      )}
                      style={{ height: `${Math.max(6, ((b.value - 80) / 20) * 100)}%` }}
                    >
                      <span className={cn("absolute -top-7 left-1/2 -translate-x-1/2 rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", now ? "bg-primary text-primary-foreground" : "pointer-events-none bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100")}>
                        {b.value}%
                      </span>
                    </div>
                    <span className={cn("text-[11px]", now ? "font-bold text-primary" : "text-muted-foreground")}>{b.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          children
        )}
        {footer && <div className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{footer}</div>}
      </Card>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- promo banner

export function HomePromo({ title, body, tag, cta, href, icon }: { title: string; body: string; tag?: string; cta: string; href: string; icon: ReactNode }) {
  return (
    <FadeIn>
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-gradient-to-r from-accent via-muted to-card p-5 shadow-[0_1px_12px_rgb(15_23_42/0.06)] ring-1 ring-foreground/5 md:flex-row md:items-center dark:shadow-none dark:ring-foreground/10">
        <div className="flex max-w-lg items-start gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md [&_svg]:size-6">{icon}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
              {tag && <span className="rounded-full bg-info/15 px-2 py-0.5 text-[11px] font-semibold text-info">{tag}</span>}
            </div>
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{body}</p>
          </div>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background shadow-sm outline-none transition-[opacity,transform] duration-(--duration-fast) hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] md:self-auto"
        >
          {cta}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- activity feed

export interface ActivityItem {
  id: string;
  icon: ReactNode;
  tone: Tone;
  title: string;
  meta?: string;
  time: string;
}

export function HomeActivity({ title, items, action, badge, empty }: { title: string; items: ActivityItem[]; action?: { href: string; label: string }; badge?: ReactNode; empty: string }) {
  return (
    <FadeIn>
      <Card className="gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-primary [&_svg]:size-5">
              <History />
            </span>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
            {badge}
          </div>
          {action && (
            <Link href={action.href} className="inline-flex items-center gap-0.5 rounded-md text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {action.label}
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
        {items.length === 0 ? (
          <p className="rounded-xl bg-muted/60 px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          // Soft fade at the scroll edge instead of a hard clip.
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)] pb-6">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-2.5 transition-colors hover:bg-muted">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]", TONE[i.tone].badge)}>{i.icon}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{i.title}</p>
                    {i.meta && <p className="truncate text-xs text-muted-foreground">{i.meta}</p>}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{i.time}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- quick actions

export interface HomeQuickAction {
  href: string;
  label: string;
  icon: ReactNode;
  tone: Tone;
}

export function HomeQuickActions({ actions }: { actions: HomeQuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <FadeIn>
      <Card className="gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-info/15 text-info [&_svg]:size-5">
            <Zap />
          </span>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Quick actions</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="group flex flex-col items-center justify-center gap-2 rounded-xl bg-muted p-3.5 text-center outline-none transition-[background-color,transform] duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              <span className={cn("flex size-10 items-center justify-center rounded-xl bg-card shadow-sm transition-transform duration-(--duration-fast) group-hover:scale-105 [&_svg]:size-[22px]", TONE[a.tone].text)}>{a.icon}</span>
              <span className="text-[13px] leading-tight font-semibold">{a.label}</span>
            </Link>
          ))}
        </div>
      </Card>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- schedule

export interface ScheduleItem {
  id: string;
  time: string;
  title: string;
  meta?: string;
}

export function HomeSchedule({ title, count, items, action, empty }: { title: string; count: string; items: ScheduleItem[]; action?: { href: string; label: string }; empty: string }) {
  return (
    <FadeIn>
      <Card className="gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-primary [&_svg]:size-[18px]">
              <CalendarClock />
            </span>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
          </div>
          {action ? (
            <Link href={action.href} className="rounded-md text-[11px] font-bold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {action.label}
            </Link>
          ) : (
            <span className="text-[11px] font-bold text-primary">{count}</span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="rounded-xl bg-muted/60 px-3 py-5 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-xl bg-muted p-2.5">
                <span className="w-16 shrink-0 rounded bg-primary/10 px-1.5 py-1 text-center text-[11px] leading-tight font-bold text-primary">{i.time}</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{i.title}</p>
                  {i.meta && <p className="truncate text-xs text-muted-foreground">{i.meta}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}
