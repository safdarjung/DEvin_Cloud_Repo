// T-027 — decision timeline for ApplicationDetail. Pure presentational.
import { EmptyState } from "@/components/states";
import type { ApplicationDecisionRow } from "@/modules/admissions/queries";

// Fixed zone: avoids server/client hydration drift (matches the attendance pages).
const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export function DecisionTimeline({ decisions }: { decisions: ApplicationDecisionRow[] }) {
  if (decisions.length === 0) {
    return <EmptyState title="No decisions recorded yet" />;
  }

  return (
    <ul className="space-y-2">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-md border border-border p-2.5 text-sm">
          <p className="font-medium capitalize">{d.decision}</p>
          {d.note && <p className="text-muted-foreground">{d.note}</p>}
          <p className="text-muted-foreground text-xs">{dateTime.format(new Date(d.createdAt))}</p>
        </li>
      ))}
    </ul>
  );
}
