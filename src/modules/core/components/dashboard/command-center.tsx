// Presentational blocks for the leader dashboard: plain text on cards, no icon
// chips, colour only on data. Server-renderable (no hooks).
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "cn";

export function Panel({
  title,
  action,
  count,
  children,
  className,
}: {
  title: string;
  action?: { href: string; label: string };
  count?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 gap-2 px-5 py-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {title}
          {count && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action && (
          <Link href={action.href} className="rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

export function PanelEmpty({ title, hint, action }: { title: string; hint?: string; action?: { href: string; label: string } }) {
  return (
    <div className="py-6">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {action && (
        <Link href={action.href} className="mt-2 inline-block text-xs underline underline-offset-2 hover:text-foreground">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}

/** Label over value; the value is the only heavy text on the tile. */
export function StatTile({ label, value, sub, href }: StatTileProps) {
  const body = (
    <Card className="h-full gap-0.5 px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatStrip({ tiles }: { tiles: StatTileProps[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {tiles.map((t) => (
        <StatTile key={t.label} {...t} />
      ))}
    </div>
  );
}

export interface SectionBar {
  id: string;
  label: string;
  percentage: number;
  absent: number;
  href: string;
}

/** Lowest-first section attendance. Bar length is the percentage; the one data hue is --chart-1. */
export function SectionBars({ rows, threshold }: { rows: SectionBar[]; threshold: number }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={r.href} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 rounded-sm py-2 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="truncate text-sm font-medium">{r.label}</span>
            <span className="h-1.5 rounded-full bg-muted" role="img" aria-label={`${r.percentage}% present`}>
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, r.percentage))}%`, background: r.percentage < threshold ? "var(--destructive)" : "var(--chart-1)" }} />
            </span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{r.percentage}%</span> · {r.absent} absent
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface FeedItem {
  id: string;
  title: string;
  meta?: string;
  time?: string;
  href?: string;
}

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y">
      {items.map((i) => {
        const body = (
          <div className="flex min-h-11 items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.title}</p>
              {i.meta && <p className="truncate text-xs text-muted-foreground">{i.meta}</p>}
            </div>
            {i.time && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.time}</span>}
          </div>
        );
        return (
          <li key={i.id}>
            {i.href ? (
              <Link href={i.href} className="block rounded-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
