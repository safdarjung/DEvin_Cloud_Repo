// T-027 — decision timeline for ApplicationDetail. Pure presentational.
import type { ApplicationDecisionRow } from "@/modules/admissions/queries";

export function DecisionTimeline({ decisions }: { decisions: ApplicationDecisionRow[] }) {
  if (decisions.length === 0) {
    return <p className="text-muted-foreground text-sm">No decisions recorded yet.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-md border border-border p-2 text-sm">
          <p className="font-medium capitalize">{d.decision}</p>
          {d.note && <p className="text-muted-foreground">{d.note}</p>}
          <p className="text-muted-foreground text-xs">{d.createdAt}</p>
        </li>
      ))}
    </ul>
  );
}
