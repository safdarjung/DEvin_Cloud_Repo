// T-039 — "what just happened": the most recent SMS/email deliveries
// (listDeliveryLog). Section-level badge shows only when any row is simulated
// (CLAUDE.md rule 7, M17 T4 ruling).
import { SimulatedBadge } from "@/components/honesty";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeliveryLogRow } from "@/modules/notifications/queries";

interface RecentActivityProps {
  entries: DeliveryLogRow[];
}

export function RecentActivity({ entries }: RecentActivityProps) {
  const hasSimulated = entries.some((e) => e.status === "simulated");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          Recent activity
          {hasSimulated && <SimulatedBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 border-border border-b pb-2 last:border-0">
                <span className="truncate">{entry.renderedBody}</span>
                <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                  {entry.channel} · {new Date(entry.attemptedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
