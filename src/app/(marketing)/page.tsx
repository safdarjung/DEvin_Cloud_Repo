import { ArrowRight } from "lucide-react";
import { HeroPreview } from "@/components/marketing/hero-preview";
import { meta } from "@/components/marketing/content";
import { ButtonLink, Container, CtaBand, REVEAL, Rows, Section } from "@/components/marketing/ui";

export const metadata = {
  ...meta(
    "Fabric — Intelligence That Moves Institutions Forward",
    "Run admissions, attendance, fees, exams and more from one platform. AI suggests; people decide.",
    "/",
  ),
  title: { absolute: "Fabric — Intelligence That Moves Institutions Forward" },
};

const PILLARS = [
  { title: "Run", body: "Admissions, attendance, fees and receipts, exams and results, assignments and your public website, in one multi-tenant system." },
  { title: "Automate", body: "Reminders, drafts and routine follow-ups prepared for you. Anything that changes a record waits for approval." },
  { title: "Unlock intelligence", body: "Insights and forecasts across modules, and an assistant that answers within the permissions of whoever asks." },
];

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-(color:--mk-line)">
        <Container className="relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div className={REVEAL}>
            <p className="text-xs font-semibold tracking-[0.14em] text-(color:--mk-accent) uppercase">Fabric</p>
            <h1 className="mt-4 text-4xl leading-[1.05] font-semibold tracking-[-0.025em] text-balance sm:text-6xl">
              Run Your Institution. Automate the Work. Unlock Its Intelligence.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-(color:--mk-muted)">
              One platform for the daily work of a school or college, with an AI layer that drafts, flags and forecasts while your people stay in charge.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/contact" arrow>
                Book a Demo
              </ButtonLink>
              <ButtonLink href="/demo" variant="secondary">
                Try a demo
              </ButtonLink>
            </div>
          </div>
          <HeroPreview className={REVEAL} />
        </Container>
      </section>

      <Section title="Three jobs, one system" lead="Fabric covers the operating work first, then builds intelligence on the same records.">
        <Rows items={PILLARS} />
      </Section>

      <Section tint title="What is built today" lead="Real capability, stated plainly, including what is simulated.">
        <ul className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
          {[
            "Admissions, attendance, exams and results, assignments",
            "Fees and receipts, with Razorpay in test mode only",
            "Website CMS serving published content only",
            "Email and WhatsApp notifications, simulated until provider keys are set",
            "AI assistant with permission checks and a cloud or local policy",
            "Insights, forecasts and agents with human approval",
            "Row-level tenant isolation and an audit log",
          ].map((t) => (
            <li key={t} className="flex gap-2 text-(color:--mk-muted)">
              <ArrowRight className="mt-1 size-4 shrink-0 text-(color:--mk-accent)" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-(color:--mk-muted)">Planned, not built: AI credits and bring-your-own-key, voice, scenario what-if modelling, marketplace purchasing, native apps.</p>
      </Section>
      <CtaBand />
    </>
  );
}
