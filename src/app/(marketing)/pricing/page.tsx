import { meta } from "@/components/marketing/content";
import { ButtonLink, CtaBand, PageHero, Rows, Section } from "@/components/marketing/ui";

export const metadata = meta("Pricing", "Fabric plans are quoted per institution. How we scope a quote.", "/pricing");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Plans are quoted per institution" lead="Institutions differ in size, modules and rollout needs, so we scope a quote with you rather than publish a rate card.">
        <ButtonLink href="/contact" arrow>Request a quote</ButtonLink>
      </PageHero>
      <Section title="What shapes a quote">
        <Rows
          items={[
            { title: "Size", body: "Approximate number of students and staff." },
            { title: "Modules", body: "Which modules you want live from day one and which later." },
            { title: "AI policy", body: "Whether models should run in the cloud or locally." },
            { title: "Rollout", body: "Data import, training and the channels you want configured, such as payments, email and WhatsApp." },
          ]}
        />
        <p className="mt-6 max-w-2xl text-sm text-(color:--mk-muted)">We do not list prices here. AI credits and bring-your-own-key are planned and not part of any plan today.</p>
      </Section>
      <CtaBand />
    </>
  );
}
