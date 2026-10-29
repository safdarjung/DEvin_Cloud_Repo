// T-039 — a single stat tile. Server-renderable: no client state, no chart
// library. `badge` carries the honesty labels (CLAUDE.md rule 7) for a
// simulated/limited figure — never render one of those without it.
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  badge?: ReactNode;
}

export function KpiTile({ label, value, sub, href, badge }: KpiTileProps) {
  const card = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {sub && <p className="text-muted-foreground text-sm">{sub}</p>}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}
