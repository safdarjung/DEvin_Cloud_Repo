import type { ReactNode } from "react";
import { Container, PageHero } from "./ui";

export function LegalPage({ title, lead, sections, review }: { title: string; lead: string; sections: { h: string; p: string }[]; review: string[] }) {
  return (
    <>
      <PageHero eyebrow="Legal" title={title} lead={lead} />
      <Container className="py-10">
        <p role="note" className="border-l-2 border-amber-600 bg-amber-500/10 px-4 py-3 text-sm font-semibold">
          Draft — requires review by qualified legal counsel before launch
        </p>
      </Container>
      <Container className="pb-20">
        <div className="max-w-3xl space-y-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-xl font-semibold">{s.h}</h2>
              <p className="mt-2 leading-relaxed text-(color:--mk-muted)">{s.p}</p>
            </section>
          ))}
          <Review items={review} />
        </div>
      </Container>
    </>
  );
}

function Review({ items }: { items: string[] }): ReactNode {
  return (
    <section>
      <h2 className="text-xl font-semibold">Items to be reviewed</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-(color:--mk-muted)">
        {items.map((i) => (
          <li key={i}>
            {i}: <strong className="font-semibold text-(color:--mk-fg)">to be reviewed</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
