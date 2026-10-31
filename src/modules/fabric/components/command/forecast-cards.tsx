import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { AnimatedNumber, Stagger, StaggerItem, type NumberFormat } from "@/components/motion";
import type { ForecastCard } from "@/modules/fabric/types";

const DIRECTION = { up: ArrowUpRight, flat: ArrowRight, down: ArrowDownRight } as const;

// paise → rupees for the shared "inr" count-up; pct values are already 0–100.
const toDisplay = (c: ForecastCard, v: number): { value: number; format: NumberFormat } =>
  c.unit === "paise" ? { value: v / 100, format: "inr" } : c.unit === "pct" ? { value: v, format: "percent" } : { value: v, format: "number" };

export function ForecastCards({ cards, base }: { cards: ForecastCard[]; base: string }) {
  return (
    <section aria-label="Forecasts">
      <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const Icon = DIRECTION[c.direction];
          const now = toDisplay(c, c.current);
          const next = toDisplay(c, c.forecast);
          return (
            <StaggerItem key={c.metric} className="min-w-0">
              <Link
                href={`${base}/fabric/insights`}
                className="block h-full rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-none transition-[box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
              >
                <p className="truncate text-xs text-muted-foreground">{c.metric}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  <AnimatedNumber value={now.value} format={now.format} />
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden />
                  Forecast <span className="font-medium text-foreground"><AnimatedNumber value={next.value} format={next.format} /></span>
                  <span className="sr-only">, trending {c.direction}</span>
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(c.confidence * 100)}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(c.confidence * 100)}% confident</span>
                </div>
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}
