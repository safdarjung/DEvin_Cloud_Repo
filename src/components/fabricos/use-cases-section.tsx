import { SECTION, USE_CASE_NOTE } from "./content";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";
import { UseCaseTabs } from "./use-case-tabs";

const id = SECTION.useCases;

export function UseCasesSection() {
  return (
    <SectionShell id={id} className="bg-(color:--fos-bg-2)">
      <ScrollReveal>
        <SectionHeading id={id} title="Built for schools and colleges. Configurable beyond them." />
        <div className="mt-14" data-reveal>
          <UseCaseTabs />
        </div>
        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-(color:--fos-muted)" data-reveal>
          {USE_CASE_NOTE}
        </p>
      </ScrollReveal>
    </SectionShell>
  );
}
