import { meta } from "@/components/marketing/content";
import { ButtonLink, CtaBand, Rows, Section, PageHero } from "@/components/marketing/ui";

export const metadata = meta("Product", "What Fabric does for an institution: operating modules, an AI layer with approvals, and tenant-isolated data.", "/product");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Product" title="One system for the daily work of an institution" lead="Fabric puts the records and routines of a school or college in one place, then adds an AI layer that works inside the same permissions.">
        <ButtonLink href="/modules" arrow>See the modules</ButtonLink>
        <ButtonLink href="/how-it-works" variant="secondary">How it works</ButtonLink>
      </PageHero>
      <Section title="Built around three ideas">
        <Rows
          items={[
            { title: "Records first", body: "Students, guardians, staff, fees, attendance and results live once, in their owning module. Other modules read them; they do not copy them." },
            { title: "Suggestions, not decisions", body: "AI output is a draft or a flag. A person saves it. AI never writes marks, payments, access or welfare decisions." },
            { title: "Your institution's data stays yours", body: "Every record is scoped to one institution and enforced in the database with row-level security." },
          ]}
        />
      </Section>
      <Section tint title="Honest about status" lead="What you see in a demo is labelled for what it is.">
        <Rows
          items={[
            { title: "Payments", body: "Razorpay test mode only. Without keys, payments are simulated.", tag: "Test mode" },
            { title: "Email and WhatsApp", body: "Simulated until provider keys are configured.", tag: "Simulated" },
            { title: "AI credits, bring-your-own-key, voice, scenario modelling, marketplace, native apps", body: "Planned. Not available today.", tag: "Planned" },
          ]}
        />
      </Section>
      <CtaBand />
    </>
  );
}
