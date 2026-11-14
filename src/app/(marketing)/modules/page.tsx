import { MODULES, meta } from "@/components/marketing/content";
import { CtaBand, PageHero, Rows, Section } from "@/components/marketing/ui";

export const metadata = meta("Modules", "Admissions, attendance, fees, exams, assignments, website, notifications, AI and audit in FabricOS.", "/modules");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Modules" title="The modules that run an institution" lead="Each module owns its records. The AI layer and insights read across them within each person's permissions." />
      <Section title="What is available today">
        <Rows items={MODULES} />
      </Section>
      <Section tint title="Planned, not built">
        <Rows
          items={[
            { title: "AI credits and bring-your-own-key", body: "Planned.", tag: "Planned" },
            { title: "Voice and speech", body: "Planned.", tag: "Planned" },
            { title: "Scenario what-if engine", body: "Planned.", tag: "Planned" },
            { title: "Marketplace purchasing", body: "Planned.", tag: "Planned" },
            { title: "Native mobile apps", body: "Planned. The web app works in a mobile browser.", tag: "Planned" },
          ]}
        />
      </Section>
      <CtaBand />
    </>
  );
}
