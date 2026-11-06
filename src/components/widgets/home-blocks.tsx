// Dashboard "home" building blocks (server-renderable): title row, KPI tile,
// bar chart card, next-step row, activity feed, quick-action list, schedule.
// Pure display: callers pass real data in.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ArrowDownRight, ChevronRight } from "lucide-react";
import { AnimatedNumber, FadeIn, Stagger, StaggerItem, type NumberFormat } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { cn } from "cn";

export type Tone = "primary" | "info" | "success" | "warning" | "destructive";

// Colour goes on meaning, not decoration: only warning/destructive tint an icon;
// everything else stays in the neutral muted ink.
const TONE_TEXT: Record<Tone, string> = {
  primary: "text-muted-foreground",
  info: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/** Section header shared by every block: 15px title, optional count/badge, optional link. */
function BlockHeader({ title, badge, action }: { title: string; badge?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
        {badge}
      </div>
      {action && (
        <Link href={action.href} className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {action.label}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- title row

export interface HeroChip {
  key: string;
  icon: ReactNode;
  label: string;
  href?: string;
  tone?: Tone;
}

/** The page's title row: a noun title, a freshness stamp, and the day's open items as links. */
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
    <FadeIn as="section" className="flex flex-col gap-4 border-b pb-5">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          <span>{eyebrow}</span>
          <span aria-hidden>·</span>
          <span>{updated}</span>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {chips.length > 0 && (
        <Stagger className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const body = (
              <>
                <span className={cn("[&_svg]:size-3.5", TONE_TEXT[c.tone ?? "primary"])}>{c.icon}</span>
                <span className="text-[13px]">{c.label}</span>
              </>
            );
            const cls = "inline-flex h-8 items-center gap-2 rounded-md border bg-card px-2.5";
            return (
              <StaggerItem key={c.key}>
                {c.href ? (
                  <Link href={c.href} className={cn(cls, "outline-none transition-colors duration-(--duration-fast) hover:border-foreground/25 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring")}>
                    {body}
                    <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <span className={cls}>{body}</span>
                )}
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </FadeIn>
  );
}

// ---------------------------------------------------------------- KPI

export function HomeKpi({
  icon,
  tone,
  label,
  value,
  animateTo,
  format,
  delta,
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
  /** Percent change; shown only when real data supplies it. */
  delta?: number;
  /** Accepted for API compatibility; trends live in their own chart, not on a KPI. */
  spark?: number[];
  footLeft?: string;
  footRight?: string;
  href?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const DeltaIcon = up ? ArrowUpRight : ArrowDownRight;
  const inner = (
    <Card className={cn("h-full gap-0 py-4", href && "transition-colors duration-(--duration-fast) group-hover/kpi:border-foreground/25")}>
      <div className="flex h-full flex-col gap-1 px-4">
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className={cn("[&_svg]:size-3.5", TONE_TEXT[tone])} aria-hidden>{icon}</span>
          {label}
        </p>
        <p className="truncate text-2xl font-semibold tracking-tight tabular-nums">
          {animateTo !== undefined ? <AnimatedNumber value={animateTo} format={format} /> : value}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          <span className="truncate">{footLeft}</span>
          {delta !== undefined ? (
            <span className={cn("inline-flex shrink-0 items-center gap-0.5 tabular-nums", delta === 0 ? "" : up ? "text-success" : "text-destructive")}>
              <DeltaIcon className="size-3" aria-hidden />
              {Math.abs(delta).toFixed(1)}%
              <span className="sr-only">{up ? " up" : " down"}</span>
            </span>
          ) : (
            footRight && <span className="shrink-0">{footRight}</span>
          )}
        </div>
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="group/kpi block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
  bars,
  footer,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  /** Percent bars (axis 80–100%), oldest first; the last one is "now" and carries the data hue. */
  bars?: { label: string; value: number }[];
  footer?: string;
  /** Real-data fallback rendered instead of `bars`. */
  children?: ReactNode;
}) {
  return (
    <FadeIn>
      <Card className="gap-4">
        <div className="px-5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        <div className="px-5">
          {bars ? (
            <>
              <p className="sr-only">{bars.map((b) => `${b.label} ${b.value}%`).join(", ")}</p>
              <div className="relative flex h-48 items-end gap-2" aria-hidden>
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                  {["100%", "90%", "80%"].map((t) => (
                    <div key={t} className="flex items-center gap-2 border-t border-dashed border-border text-[11px] text-muted-foreground">
                      <span className="-mt-4">{t}</span>
                    </div>
                  ))}
                </div>
                <div className="w-9 shrink-0" />
                {bars.map((b, i) => {
                  const now = i === bars.length - 1;
                  return (
                    <div key={b.label} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <span className={cn("text-[11px] tabular-nums", now ? "font-medium text-foreground" : "text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100")}>{b.value}%</span>
                      <div
                        className={cn("w-full max-w-10 origin-bottom rounded-t-[3px] transition-colors duration-(--duration-normal) motion-safe:animate-[grow_600ms_var(--ease-out)_both]", now ? "bg-(--chart-1)" : "bg-muted-foreground/25 group-hover:bg-muted-foreground/40")}
                        style={{ height: `${Math.max(4, ((b.value - 80) / 20) * 82)}%` }}
                      />
                      <span className={cn("text-[11px]", now ? "font-medium text-foreground" : "text-muted-foreground")}>{b.label}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            children
          )}
        </div>
        {footer && <p className="border-t px-5 pt-3 text-xs text-muted-foreground">{footer}</p>}
      </Card>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- next-step row

export function HomePromo({ title, body, tag, cta, href, icon }: { title: string; body: string; tag?: string; cta: string; href: string; icon: ReactNode }) {
  return (
    <FadeIn>
      <div className="flex flex-col justify-between gap-3 rounded-lg border bg-card px-5 py-4 md:flex-row md:items-center">
        <div className="flex max-w-xl items-start gap-3">
          <span className="mt-0.5 text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
              {tag && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{tag}</span>}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{body}</p>
          </div>
        </div>
        <Link
          href={href}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-opacity duration-(--duration-fast) hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] md:self-auto"
        >
          {cta}
          <ArrowRight className="size-3.5" aria-hidden />
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
      <Card className="gap-2 pb-2">
        <BlockHeader title={title} badge={badge} action={action} />
        {items.length === 0 ? (
          <p className="mx-5 my-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-accent/50">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("shrink-0 [&_svg]:size-4", TONE_TEXT[i.tone])} aria-hidden>{i.icon}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{i.title}</p>
                    {i.meta && <p className="truncate text-xs text-muted-foreground">{i.meta}</p>}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{i.time}</span>
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
      <Card className="gap-2 pb-2">
        <BlockHeader title="Quick actions" />
        <ul className="divide-y">
          {actions.map((a) => (
            <li key={a.href + a.label}>
              <Link
                href={a.href}
                className="group flex items-center gap-3 px-5 py-2.5 text-[13px] outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 focus-visible:bg-accent"
              >
                <span className="text-muted-foreground transition-colors group-hover:text-foreground [&_svg]:size-4" aria-hidden>{a.icon}</span>
                <span className="flex-1 font-medium">{a.label}</span>
                <ChevronRight className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
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
      <Card className="gap-2 pb-2">
        <BlockHeader title={title} badge={!action ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : undefined} action={action} />
        {items.length === 0 ? (
          <p className="mx-5 my-3 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id} className="flex items-baseline gap-4 px-5 py-2.5">
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{i.time}</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{i.title}</p>
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
