import { PROBLEM } from "./content";
import { ProblemDiagram } from "./problem-diagram";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

export function ProblemSection() {
  return (
    <SectionShell id="problem" className="border-t border-(color:--fos-line)">
      <ScrollReveal className="grid items-center gap-14 lg:grid-cols-[5fr_7fr] lg:gap-20">
        <div>
          <h2 id="problem-title" className="fos-h2" data-reveal>
            {PROBLEM.title}
          </h2>
          <p className="fos-lead mt-6" data-reveal>
            {PROBLEM.lead}
          </p>
          <p className="mt-10 max-w-md border-t border-(color:--fos-line-strong) pt-6 text-lg leading-relaxed text-(color:--fos-fg)" data-reveal>
            {PROBLEM.resolution}
          </p>
        </div>
        <ProblemDiagram />
      </ScrollReveal>
    </SectionShell>
  );
}
