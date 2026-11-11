import type { AuditEventRow } from "@/modules/fabric/types";

const WHAT: Record<string, string> = {
  "core.module.set": "Changed a module",
  "core.feature.set": "Changed a feature",
  "core.ai_role.set": "Changed AI settings for a role",
};

export function RecentChanges({ rows }: { rows: readonly AuditEventRow[] }) {
  return (
    <section aria-labelledby="recent-changes" className="space-y-2">
      <h2 id="recent-changes" className="text-base font-semibold">Recent changes</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <span>{WHAT[r.event] ?? r.event}</span>
              <span className="text-xs text-muted-foreground">
                {r.actor} ({r.actor_role.replace(/_/g, " ")}) · <time dateTime={r.at}>{new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
