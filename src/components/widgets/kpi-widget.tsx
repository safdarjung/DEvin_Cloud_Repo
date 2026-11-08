// A single stat tile (+ optional delta chip). Server-renderable. `badge` carries
// the honesty labels (CLAUDE.md rule 7) for a simulated/limited figure.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { AnimatedNumber, type NumberFormat } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkline, TONE_TEXT, type VizTone } from "@/components/widgets/viz";
import { cn } from "cn";

export interface KpiDelta {
  value: number;
  label: string;
  /** Default true: an increase is good. Set false for e.g. outstanding fees. */
  positiveIsGood?: boolean;
}

export interface KpiTileProps {
  label: string;
  value: string;
  /** When set, counts up to this number (format key is serializable); `value` stays the fallback string. */
  animateTo?: number;
  format?: NumberFormat;
  sub?: string;
  href?: string;
  badge?: ReactNode;
  delta?: KpiDelta;
  /** Tiny trend under the value (oldest first). Needs >= 2 points. */
  spark?: number[];
  /** Colours the value. Default: foreground. */
  tone?: VizTone;
}

function DeltaChip({ value, label, positiveIsGood = true }: KpiDelta) {
  const tone = value === 0 ? "neutral" : value > 0 === positiveIsGood ? "good" : "bad";
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        tone === "good" && "text-success",
        tone === "bad" && "text-destructive",
        tone === "neutral" && "text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {value > 0 ? "+" : ""}
      {value}% {label}
    </span>
  );
}

export function KpiTile({ label, value, animateTo, format, sub, href, badge, delta, spark, tone = "default" }: KpiTileProps) {
  const card = (
    <Card className={cn("h-full", href && "group-hover/kpi:border-ring/60 group-hover/kpi:shadow-sm")}>
      <CardContent className="@container flex flex-col">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {label}
          {badge}
        </p>
        <p
          className={cn(
            "mt-1.5 leading-tight font-bold tracking-tight tabular-nums",
            // Long values (₹ amounts) scale with the tile instead of breaking mid-number.
            value.length > 8 ? "text-[clamp(1.125rem,10.5cqi,2rem)] whitespace-nowrap" : "text-[26px] sm:text-[28px] 2xl:text-[32px]",
            TONE_TEXT[tone],
          )}
        >
          {animateTo === undefined ? value : <AnimatedNumber value={animateTo} format={format} />}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        {delta && <DeltaChip {...delta} />}
        {spark && spark.length > 1 && (
          <Sparkline data={spark} summary={`${label} trend: ${spark.length} points, from ${spark[0]} to ${spark.at(-1)}.`} />
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="group/kpi block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {card}
    </Link>
  ) : (
    card
  );
}

/** Named alias: the KPI tile with its optional `delta` chip. */
export const KpiWidget = KpiTile;

/**
 * Kit `tile_count` row: tiles share one card, split by 2px vertical dividers
 * (clipped on the first tile of each row). Children are `KpiTile`/`KpiWidget`.
 * Usage: `<KpiStrip><KpiTile label="Students" value="412" /> ...</KpiStrip>`
 */
export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div
        className={cn(
          "-mt-px -ml-0.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
          "*:border-t *:border-l-2 *:border-border",
          "[&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent",
        )}
      >
        {children}
      </div>
    </div>
  );
}
