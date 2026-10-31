// T-039 — a single stat tile. Server-renderable: no client state, no chart
// library. `badge` carries the honesty labels (CLAUDE.md rule 7) for a
// simulated/limited figure — never render one of those without it.
import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedNumber, type NumberFormat } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface KpiTileProps {
  label: string;
  value: string;
  /** When set, counts up to this number (format key is serializable); `value` stays the fallback string. */
  animateTo?: number;
  format?: NumberFormat;
  sub?: string;
  href?: string;
  badge?: ReactNode;
}

export function KpiTile({ label, value, animateTo, format, sub, href, badge }: KpiTileProps) {
  const card = (
    <Card className={href ? "h-full transition-shadow duration-(--duration-fast) ease-(--ease-out) group-hover/kpi:shadow-md" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {label}
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {animateTo === undefined ? value : <AnimatedNumber value={animateTo} format={format} />}
        </p>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
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
