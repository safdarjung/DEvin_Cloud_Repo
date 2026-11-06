// A single stat tile (+ optional delta chip). Server-renderable. `badge` carries
// the honesty labels (CLAUDE.md rule 7) for a simulated/limited figure.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { AnimatedNumber, type NumberFormat } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
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
}

function DeltaChip({ value, label, positiveIsGood = true }: KpiDelta) {
  const tone = value === 0 ? "neutral" : value > 0 === positiveIsGood ? "good" : "bad";
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-1 text-xs font-medium tabular-nums",
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

export function KpiTile({ label, value, animateTo, format, sub, href, badge, delta }: KpiTileProps) {
  const card = (
    <Card className={cn("h-full", href && "group-hover/kpi:border-foreground/20")}>
      <CardContent className="flex flex-col">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {label}
          {badge}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
          {animateTo === undefined ? value : <AnimatedNumber value={animateTo} format={format} />}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        {delta && <DeltaChip {...delta} />}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="group/kpi block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {card}
    </Link>
  ) : (
    card
  );
}

/** Named alias: the KPI tile with its optional `delta` chip. */
export const KpiWidget = KpiTile;
