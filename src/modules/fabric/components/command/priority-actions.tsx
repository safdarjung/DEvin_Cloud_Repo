"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { Widget } from "@/components/widgets/widget";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import type { PriorityAction } from "@/modules/fabric/types";
import { resolveHref, SEVERITY } from "./severity";

const dueFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });

export function PriorityActionsWidget({ actions, base }: { actions: PriorityAction[]; base: string }) {
  // "Done" hides for this session only, as the packet specifies.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const open = actions.filter((a) => !done.has(a.id));

  return (
    <Widget title="Priorities" description={`${open.length} to act on`}>
      {open.length === 0 ? (
        <EmptyState title="All caught up" description="Nothing left on today's priority list." />
      ) : (
        <ul className="-my-1 divide-y">
          {open.map((a) => {
            const sev = SEVERITY[a.severity];
            const Icon = sev.icon;
            return (
              <li key={a.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <Icon className={`size-4 shrink-0 ${sev.text}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={a.why}>
                    {a.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-medium">{sev.label}</span> · {a.owner} · due {dueFmt.format(new Date(a.due))}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={resolveHref(base, a.href)}>Open</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Mark done: ${a.title}`}
                  onClick={() => setDone((d) => new Set(d).add(a.id))}
                >
                  <Check aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
