import { LeadForm } from "@/components/marketing/lead-form";
import { meta } from "@/components/marketing/content";
import { Container, PageHero } from "@/components/marketing/ui";

export const metadata = meta("Contact", "Book a Fabric demo or send us a question.", "/contact");

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Book a demo or ask a question" lead="Tell us about your institution. We reply to the email you give; nothing is sent to anyone else." />
      <Container className="py-14">
        <div className="max-w-2xl">
          <LeadForm />
        </div>
      </Container>
    </>
  );
}
