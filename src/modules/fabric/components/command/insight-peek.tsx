import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Widget } from "@/components/widgets/widget";
import type { Insight } from "@/modules/fabric/types";
import { SEVERITY } from "./severity";

export function InsightPeek({ items, base }: { items: Insight[]; base: string }) {
  return (
    <Widget title="Insights" icon={<Sparkles />} action={{ href: `${base}/fabric/insights`, label: "All insights" }}>
      <ul className="-my-1 divide-y">
        {items.map((i) => {
          const sev = SEVERITY[i.severity];
          const Icon = sev.icon;
          return (
            <li key={i.id}>
              <Link
                href={`${base}/fabric/insights?id=${i.id}`}
                className="-mx-1 flex items-start gap-2 rounded-md px-1 py-2 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${sev.text}`} aria-hidden />
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{i.title}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    <span className="font-medium">{sev.label}</span> · {i.pattern}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{Math.round(i.confidence * 100)}%</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
