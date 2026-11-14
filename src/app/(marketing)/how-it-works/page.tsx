import { meta } from "@/components/marketing/content";
import { CtaBand, PageHero, Rows, Section } from "@/components/marketing/ui";

export const metadata = meta("How it works", "From first conversation to a live institution on FabricOS.", "/how-it-works");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="How it works" title="From first call to a working institution" lead="A staged rollout so staff learn one module at a time." />
      <Section title="The path">
        <Rows
          items={[
            { title: "1. Demo", body: "See the modules on sample data, as the roles that will use them." },
            { title: "2. Scope", body: "Agree modules, AI policy and the channels to configure, then a quote." },
            { title: "3. Set up", body: "Create your institution, roles and permissions, and import your records." },
            { title: "4. Go live by module", body: "Start with the work that hurts most, such as attendance or fees, then add the rest." },
            { title: "5. Add intelligence", body: "Turn on the assistant, insights and agents once the records are flowing. Approvals stay with your people." },
          ]}
        />
      </Section>
      <CtaBand />
    </>
  );
}
