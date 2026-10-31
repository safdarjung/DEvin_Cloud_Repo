import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Widget } from "@/components/widgets/widget";
import type { RiskIndicator } from "@/modules/fabric/types";
import { SEVERITY } from "./severity";

const TREND = { up: ArrowUp, flat: ArrowRight, down: ArrowDown } as const;

export function RiskIndicators({ risks, base }: { risks: RiskIndicator[]; base: string }) {
  return (
    <Widget title="Risks" description="Level and direction of change">
      <ul className="flex flex-wrap gap-2">
        {risks.map((r) => {
          const sev = SEVERITY[r.level];
          const Icon = sev.icon;
          const Trend = TREND[r.trend];
          return (
            <li key={r.id}>
              <Link
                href={r.insight_id ? `${base}/fabric/insights?id=${r.insight_id}` : `${base}/fabric/insights`}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-transform duration-(--duration-fast) ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${sev.chip}`}
              >
                <Icon className="size-3.5" aria-hidden />
                <span className="font-medium">{sev.label}</span>
                <span className="text-foreground">{r.label}</span>
                <Trend className="size-3" aria-hidden />
                <span className="sr-only">trend {r.trend}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
