import { INSIGHTS, NODES, SECTION } from "./content";
import { InsightsChart } from "./insights-chart";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionHeading, SectionShell } from "./section-shell";

const id = SECTION.insights;
const lead = NODES.find((n) => n.id === "insights")?.blurb;

export function InsightsSection() {
  return (
    <SectionShell id={id} className="bg-[radial-gradient(80%_60%_at_85%_30%,rgb(12_18_36),transparent_70%)]">
      <ScrollReveal>
        <div className="grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div>
            <SectionHeading id={id} title="See what needs a decision today." lead={lead} />
            <ul className="mt-12 border-t border-(color:--fos-line)">
              {INSIGHTS.signals.map((s) => (
                <li key={s.title} className="grid gap-1 border-b border-(color:--fos-line) py-5 sm:grid-cols-[11rem_1fr] sm:gap-6" data-reveal>
                  <h3 className="font-medium text-(color:--fos-fg)">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-(color:--fos-muted)">{s.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:pt-28" data-reveal>
            <InsightsChart />
          </div>
        </div>
        <div className="fos-media mt-16 overflow-hidden rounded-[20px] border border-(color:--fos-line) bg-(color:--fos-surface)" data-reveal>
          <ProductVideo id="insights" variant="loop" />
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
