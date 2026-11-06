import { meta } from "@/components/marketing/content";
import { Callout, CtaBand, PageHero, Rows, Section } from "@/components/marketing/ui";

export const metadata = meta("Security", "How Fabric separates institutions, checks permissions twice, keeps history immutable and controls AI.", "/security");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Security" title="Designed so one institution never sees another" lead="Controls are built into the data layer and the application, not added around them." />
      <Section title="What is in place">
        <Rows
          items={[
            { title: "Tenant isolation", body: "Every tenant record carries its institution. Row-level security in the database enforces the boundary independently of application code." },
            { title: "Two-layer authorization", body: "The database restricts data; every server action also checks a named permission. Hiding a button is never the control." },
            { title: "Immutable history", body: "Payments, receipts, marks, results and audit events are never edited in place. Corrections add a new version." },
            { title: "Audit log", body: "Sensitive actions are recorded as append-only events." },
            { title: "AI boundary", body: "All model calls pass through one gateway that applies your cloud or local policy. AI output is a suggestion a person saves." },
            { title: "Secrets", body: "Provider keys are kept in environment configuration, not in the codebase." },
          ]}
        />
        <Callout>This site makes no certification, audit or compliance claims. Ask for the current security detail during a demo.</Callout>
      </Section>
      <CtaBand />
    </>
  );
}
