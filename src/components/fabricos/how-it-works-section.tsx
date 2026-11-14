import { HOW_IT_WORKS, SECTION } from "./content";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = SECTION.howItWorks;

export function HowItWorksSection() {
  return (
    <SectionShell id={id} className="border-t border-(color:--fos-line)">
      <ScrollReveal>
        <SectionHeading id={id} title="How it works" lead="FabricOS is set up with you, around how your institution already runs. Five steps, in order." />
        <ol className="mt-16 grid gap-0 md:grid-cols-5">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="relative grid grid-cols-[3rem_1fr] gap-x-4 border-t border-(color:--fos-line) py-7 md:block md:border-t-0 md:border-l md:py-0 md:pr-6 md:pl-6" data-reveal>
              <span aria-hidden className="font-mono text-sm text-(color:--fos-cyan) tabular-nums md:block md:pb-14">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-lg leading-snug font-medium tracking-[-0.015em] text-pretty text-(color:--fos-fg)">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(color:--fos-muted)">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </ScrollReveal>
    </SectionShell>
  );
}
