"use client";
// features-18 §D — "What needs attention": timetable conflicts and section
// anomalies (lab_section_anomalies, |z| >= 1.5) ranked by lab.rankAttention.
// Clicking an item opens that node's drawer (where a section can be explained).
import { SEVERITY } from "@/modules/fabric/components/command/severity";
import type { AttentionItem } from "@/modules/fabric/lab";

const MAX_ITEMS = 8;

export function AttentionPanel({ items, onSelect }: { items: AttentionItem[]; onSelect: (nodeId: string) => void }) {
  return (
    <section className="space-y-2 rounded-lg border p-3" aria-label="What needs attention">
      <p className="text-sm font-medium">What needs attention</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing stands out: no timetable conflicts and no section more than 1.5 standard deviations from the school average.
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.slice(0, MAX_ITEMS).map((item) => {
            const sev = SEVERITY[item.severity];
            const body = (
              <>
                <sev.icon className={`mt-0.5 size-3.5 shrink-0 ${sev.text}`} aria-hidden />
                <span>
                  <span className="font-medium">{item.label}</span>: {item.reason}
                  <span className="sr-only"> ({sev.label})</span>
                </span>
              </>
            );
            return (
              <li key={`${item.nodeId ?? item.label}-${item.reason}`}>
                {item.nodeId ? (
                  <button
                    type="button"
                    onClick={() => onSelect(item.nodeId!)}
                    className="flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-1.5 px-2 py-1 text-sm">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
