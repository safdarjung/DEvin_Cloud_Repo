import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Widget } from "@/components/widgets/widget";
import { resolveHref } from "./severity";
import type { DailyBrief } from "@/modules/fabric/types";

export function DailyBriefWidget({ brief, base }: { brief: DailyBrief; base: string }) {
  return (
    <Widget title="Today's brief" description={brief.headline} icon={<Sparkles />}>
      <ul className="-my-1 divide-y">
        {brief.items.map((item) => (
          <li key={item.text} className="py-2 text-sm leading-snug first:pt-0 last:pb-0">
            {item.href ? (
              <Link
                href={resolveHref(base, item.href)}
                className="group/b -mx-1 flex items-start justify-between gap-2 rounded-md px-1 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{item.text}</span>
                <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-hover/b:translate-x-0.5 group-hover/b:-translate-y-0.5" aria-hidden />
              </Link>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
    </Widget>
  );
}
