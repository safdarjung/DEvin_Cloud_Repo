import { AgentDemo } from "./agent-demo";
import { NODES, SECTION } from "./content";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = SECTION.agents;
const lead = NODES.find((n) => n.id === "agents")?.blurb;

/** `media={false}` leaves out the recording, for a page that already shows it in the product tour. */
export function AgentsSection({ media = true }: { media?: boolean }) {
  return (
    <SectionShell id={id}>
      <ScrollReveal>
        <SectionHeading id={id} title="From asking questions to getting work done." lead={lead} />
        <div className="mt-14" data-reveal>
          <AgentDemo />
        </div>
        {media ? (
          <div className="fos-media mt-6 overflow-hidden rounded-[20px] border border-(color:--fos-line) bg-(color:--fos-surface)" data-reveal>
            <ProductVideo id="agents" variant="loop" />
          </div>
        ) : null}
      </ScrollReveal>
    </SectionShell>
  );
}
