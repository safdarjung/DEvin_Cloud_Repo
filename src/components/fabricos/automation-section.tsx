import { NODES, SECTION } from "./content";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";
import { WorkflowDiagram } from "./workflow-diagram";

const id = SECTION.automation;
const lead = NODES.find((n) => n.id === "automation")?.blurb;

/** `media={false}` leaves out the recording, for a page that already shows it in the product tour. */
export function AutomationSection({ media = true }: { media?: boolean }) {
  return (
    <SectionShell id={id}>
      <ScrollReveal>
        <SectionHeading id={id} title="Work that moves itself forward, with a person at every decision." lead={lead} />
      </ScrollReveal>
      <div className="mt-20">
        <WorkflowDiagram />
      </div>
      <ScrollReveal>
        {media ? (
          <div className="fos-media mt-20 overflow-hidden rounded-[20px] border border-(color:--fos-line) bg-(color:--fos-surface)" data-reveal>
            <ProductVideo id="automation" variant="loop" />
          </div>
        ) : null}
      </ScrollReveal>
    </SectionShell>
  );
}
