import { CONNECTED } from "./content";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = "connected";

export function ConnectedSection() {
  return (
    <SectionShell id={id} className="border-t border-(color:--fos-line)">
      <ScrollReveal>
        <SectionHeading
          id={id}
          title="One connected organisation."
          lead="Every role works from the same records, and each person sees them through the permissions of their own role."
        />
        <div className="relative mt-16">
          {/* the thread that ties the five together */}
          <span aria-hidden data-reveal-clip className="absolute top-[7px] right-0 left-0 hidden h-px bg-[linear-gradient(90deg,transparent,#67d7ea_12%,#8b93ff_88%,transparent)] md:block" />
          <ul className="grid gap-px md:grid-cols-5">
            {CONNECTED.map((c) => (
              <li key={c.title} className="relative border-l border-(color:--fos-line) pt-0 pr-4 pl-5 md:pt-10" data-reveal>
                <span aria-hidden className="absolute top-0 -left-[4.5px] hidden size-2 rounded-full bg-(color:--fos-cyan) shadow-[0_0_0_4px_var(--fos-bg)] md:block" />
                <h3 className="text-2xl font-medium tracking-[-0.03em] text-(color:--fos-fg)">{c.title}</h3>
                <p className="mt-2 pb-6 text-sm leading-relaxed text-(color:--fos-muted) md:pb-0">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="fos-media mt-16 overflow-hidden rounded-[20px] border border-(color:--fos-line) bg-(color:--fos-surface)" data-reveal>
          <ProductVideo id="roles" variant="loop" />
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
