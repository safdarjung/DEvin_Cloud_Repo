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
    <ul className="ml-1.5 space-y-3 border-l-2 border-border">
      {decisions.map((d) => (
        <li key={d.id} className="relative pl-4 text-sm">
          <span aria-hidden className="absolute top-1 -left-[6px] size-2.5 rounded-full border-2 border-ring bg-card" />
          <p className="font-semibold capitalize">{d.decision}</p>
          {d.note && <p className="text-muted-foreground">{d.note}</p>}
          <p className="text-xs text-muted-foreground italic">{dateTime.format(new Date(d.createdAt))}</p>
        </li>
      ))}
    </ul>
  );
}
