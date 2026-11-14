import { meta } from "@/components/marketing/content";
import { Callout, CtaBand, PageHero, Rows, Section } from "@/components/marketing/ui";

export const metadata = meta("AI", "FabricOS's AI assistant, insights and agents: permission-checked, policy-controlled, and approved by people.", "/ai");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="AI" title="Intelligence that suggests. People decide." lead="FabricOS's AI layer drafts, flags and forecasts. It works inside the same permissions as the person using it, and your institution controls where models run." />
      <Section title="What it does">
        <Rows
          items={[
            { title: "Assistant", body: "Answers questions and drafts content using only what the signed-in person is allowed to see." },
            { title: "Insights and forecasts", body: "Highlights attendance, collections and admissions patterns that need attention." },
            { title: "Agents", body: "Prepare routine work such as reminders or recheck summaries. Each proposed action waits in an approvals queue." },
          ]}
        />
      </Section>
      <Section tint title="Controls">
        <Rows
          items={[
            { title: "Permission checks", body: "The assistant cannot reach data the user could not open themselves." },
            { title: "Cloud or local policy", body: "Your institution chooses. With local-only, no cloud provider is used." },
            { title: "Human approval", body: "AI never writes marks, payments, access or welfare decisions. A person saves or approves the result." },
          ]}
        />
        <Callout>Planned, not available yet: AI credits, bring-your-own-key, voice and speech, and a scenario what-if engine.</Callout>
      </Section>
      <CtaBand />
    </>
  );
}
