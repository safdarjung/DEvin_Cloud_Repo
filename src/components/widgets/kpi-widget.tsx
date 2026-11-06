// A single stat tile (+ optional delta chip). Server-renderable. `badge` carries
// the honesty labels (CLAUDE.md rule 7) for a simulated/limited figure.
import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, CalendarCheck, GraduationCap, Minus, Users, Wallet } from "lucide-react";
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

function KpiIcon({ label }: { label: string }) {
  const l = label.toLowerCase();
  const Icon = /fee|₹|revenue|collect|due|paid|defaulter|invoice/.test(l)
    ? Wallet
    : /attend|present|absent/.test(l)
      ? CalendarCheck
      : /exam|result|mark|paper|grade/.test(l)
        ? GraduationCap
        : /student|staff|teacher|applic|enquir|admission|guardian/.test(l)
          ? Users
          : Activity;
  return <Icon className="size-5" />;
}

function DeltaChip({ value, label, positiveIsGood = true }: KpiDelta) {
  const tone = value === 0 ? "neutral" : value > 0 === positiveIsGood ? "good" : "bad";
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
        tone === "good" && "bg-success/15 text-success",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground",
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
    <Card className={href ? "h-full" : undefined}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {label}
            {badge}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
            {animateTo === undefined ? value : <AnimatedNumber value={animateTo} format={format} />}
          </p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          {delta && <DeltaChip {...delta} />}
        </div>
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-primary text-primary-foreground shadow-(--brand-glow)">
          <KpiIcon label={label} />
        </span>
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
