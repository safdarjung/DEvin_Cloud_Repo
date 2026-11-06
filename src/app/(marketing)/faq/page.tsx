import { FAQ, meta } from "@/components/marketing/content";
import { Container, CtaBand, PageHero } from "@/components/marketing/ui";

export const metadata = meta("FAQ", "Straight answers about Fabric: payments, messaging, AI, data isolation and what is planned.", "/faq");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="FAQ" title="Questions, answered plainly" lead="Including what is simulated and what is still planned." />
      <Container className="py-14">
        <div className="divide-y divide-(color:--mk-line) border-y border-(color:--mk-line)">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-1">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-3 font-semibold marker:content-none focus-visible:outline-2 focus-visible:outline-(color:--mk-accent) [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-(color:--mk-accent) transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 leading-relaxed text-(color:--mk-muted)">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
      <CtaBand />
    </>
  );
}
