import { LeadForm } from "@/components/marketing/lead-form";
import { meta } from "@/components/marketing/content";
import { Container, PageHero } from "@/components/marketing/ui";
import { threadsMessage } from "@/components/home/threads";

export const metadata = meta("Contact", "Book a FabricOS demo or send us a question.", "/contact");

export default async function Page({ searchParams }: { searchParams: Promise<{ threads?: string | string[] }> }) {
  const { threads } = await searchParams;
  return (
    <>
      <PageHero eyebrow="Contact" title="Book a demo or ask a question" lead="Tell us about your institution. We reply to the email you give; nothing is sent to anyone else." />
      <Container className="py-14">
        <div className="max-w-2xl">
          <LeadForm defaultMessage={threadsMessage(typeof threads === "string" ? threads : undefined)} />
        </div>
      </Container>
    </>
  );
}
