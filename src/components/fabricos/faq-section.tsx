import { Plus } from "lucide-react";
import { FAQ, SECTION } from "./content";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = SECTION.faq;

/** Native details/summary: answers ship in the server HTML and stay crawlable. */
export function FaqSection() {
  return (
    <SectionShell id={id}>
      <ScrollReveal className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
        <h2 id={`${id}-title`} className="fos-h2 lg:sticky lg:top-28 lg:self-start" data-reveal>
          Frequently asked questions
        </h2>
        <div className="border-t border-(color:--fos-line)">
          {FAQ.map((f, i) => (
            <details key={f.q} className="fos-faq group border-b border-(color:--fos-line)" open={i === 0} data-reveal>
              <summary className="flex min-h-11 items-start justify-between gap-6 py-6 text-left">
                <h3 className="text-lg leading-snug font-medium tracking-[-0.015em] text-(color:--fos-fg)">{f.q}</h3>
                <Plus className="fos-faq-icon mt-1 size-5 shrink-0 text-(color:--fos-muted)" aria-hidden />
              </summary>
              <p className="max-w-[65ch] pr-10 pb-7 leading-relaxed text-(color:--fos-muted)">{f.a}</p>
            </details>
          ))}
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
