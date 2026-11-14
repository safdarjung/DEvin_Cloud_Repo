import { SECTION, TRUST } from "./content";
import { ProposalCard } from "./proposal-card";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = SECTION.trust;

export function TrustSection() {
  return (
    <SectionShell id={id}>
      <ScrollReveal className="grid gap-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-20">
        <div>
          <SectionHeading id={id} title={TRUST.title} lead={TRUST.lead} />
          <ul className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {TRUST.points.map((p) => (
              <li key={p.title} className="border-t border-(color:--fos-line-strong) pt-5" data-reveal>
                <h3 className="font-medium text-(color:--fos-fg)">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(color:--fos-muted)">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div data-reveal data-parallax="6">
          <ProposalCard />
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
