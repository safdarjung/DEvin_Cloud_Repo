"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "cn";

export interface CarouselInsight {
  id: string;
  title: string;
  body: string;
  severityLabel: string;
  confidence: number;
  href: string;
}

/** One insight at a time; the dots pick which. Navigation only — never acts on an insight (rule 6). */
export function InsightCarousel({ items, allHref, footer }: { items: CarouselInsight[]; allHref: string; footer?: ReactNode }) {
  const [i, setI] = useState(0);
  const cur = items[i];
  if (!cur) return null;
  return (
    <Card className="gap-3 bg-gradient-to-br from-card to-muted p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-[18px]" aria-hidden />
          </span>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">AI insights</h2>
        </div>
        <Link href={allHref} className="inline-flex items-center gap-1 rounded-md text-[13px] font-bold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          View all {items.length}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-card p-3.5 shadow-sm" aria-live="polite">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lightbulb className="size-[22px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] leading-5 font-semibold">{cur.title}</p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{cur.body}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            <span className="font-semibold">{cur.severityLabel}</span> · {Math.round(cur.confidence * 100)}% confidence
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex items-center gap-1.5" role="group" aria-label="Choose insight">
          {items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              aria-label={`Insight ${idx + 1}: ${it.title}`}
              aria-current={idx === i}
              onClick={() => setI(idx)}
              className={cn("h-2 rounded-full outline-none transition-[width,background-color] duration-(--duration-normal) ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring", idx === i ? "w-5 bg-primary" : "w-2 bg-border hover:bg-muted-foreground")}
            />
          ))}
        </div>
        <Link href={cur.href} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-accent px-3 text-[13px] font-semibold text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring">
          Open insight
        </Link>
      </div>
      {footer}
    </Card>
  );
}
