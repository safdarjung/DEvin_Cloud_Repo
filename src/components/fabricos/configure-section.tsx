import { ConfigureStack } from "./configure-stack";
import { DESCRIPTION } from "./content";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = "configure";

export function ConfigureSection() {
  return (
    <SectionShell id={id} className="bg-(color:--fos-bg-2)">
      <ScrollReveal>
        <SectionHeading id={id} title="An operating system you configure, not one you adapt to." lead={DESCRIPTION} />
        <div className="mt-16" data-reveal>
          <ConfigureStack />
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
