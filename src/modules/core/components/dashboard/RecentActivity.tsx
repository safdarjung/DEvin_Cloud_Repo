// T-039 — "what just happened": the most recent simulated SMS/email
// deliveries (listDeliveryLog). Always rendered with <SimulatedBadge />
// (CLAUDE.md rule 7) — these never go to a real provider (06 §3).
import { SimulatedBadge } from "@/components/honesty";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeliveryLogRow } from "@/modules/notifications/queries";

interface RecentActivityProps {
  entries: DeliveryLogRow[];
}

export function RecentActivity({ entries }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          Recent activity
          <SimulatedBadge />
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
                  {entry.channel} · {new Date(entry.attemptedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
