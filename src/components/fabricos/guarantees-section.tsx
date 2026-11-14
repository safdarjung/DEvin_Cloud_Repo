// How the system is built to be trusted, and what is not finished yet, in the product's own words.
import { HONESTY_TEXT, PLAIN_FACTS, TRUST as GUARANTEES } from "@/components/home/story";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = "guarantees";

export function GuaranteesSection() {
  return (
    <SectionShell id={id} className="!pt-0">
      <ScrollReveal className="grid gap-12 border-t border-(color:--fos-line) pt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <div>
          <h2 id={`${id}-title`} className="text-3xl leading-[1.08] font-medium tracking-[-0.03em] text-(color:--fos-fg) md:text-[2.5rem]" data-reveal>
            Built so it cannot go wrong quietly.
          </h2>
          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {GUARANTEES.map((g, i) => (
              <li key={g.key} className="border-t border-(color:--fos-line-strong) pt-5" data-reveal>
                <p className="font-(family-name:--fos-font-mono) text-xs text-(color:--fos-cyan)">0{i + 1}</p>
                <h3 className="mt-2 font-medium text-(color:--fos-fg)">{g.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(color:--fos-muted)">{g.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <aside aria-labelledby={`${id}-plain`} className="self-start rounded-[20px] border border-dashed border-[color-mix(in_oklab,var(--fos-warn)_45%,transparent)] p-6 sm:p-8" data-reveal>
          <h3 id={`${id}-plain`} className="text-xl font-medium tracking-[-0.02em] text-(color:--fos-fg)">
            Stated plainly
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-(color:--fos-muted)">What is not finished, in the same words the product uses on screen.</p>
          <ul className="mt-6 grid gap-4">
            {PLAIN_FACTS.map((f) => (
              <li key={f.text} className="grid gap-1.5 text-sm leading-relaxed text-(color:--fos-muted)">
                <span className="fos-honest w-fit">{f.label === "planned" ? "Planned" : HONESTY_TEXT[f.label]}</span>
                {f.text}
              </li>
            ))}
          </ul>
        </aside>
      </ScrollReveal>
    </SectionShell>
  );
}
