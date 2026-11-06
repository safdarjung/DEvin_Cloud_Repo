import { meta } from "@/components/marketing/content";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = meta("Privacy notice", "Draft privacy notice for Fabric. Requires legal review.", "/legal/privacy");

const SECTIONS = [
  { h: "Status of this document", p: "This is a working draft prepared for internal review. It is not legal advice and has not been approved for publication." },
  { h: "What this will cover", p: "The categories of personal information processed by the platform, why, who receives it, how long it is kept, and how people can exercise their rights." },
  { h: "Contact form", p: "Details submitted through the contact and demo forms are used to reply to the request." },
];

const REVIEW = [
  "Digital Personal Data Protection Act, 2023 obligations and roles (data fiduciary and processor)",
  "Children's data: verifiable parental consent and restrictions on tracking and targeted advertising",
  "Lawful basis and notice wording",
  "Retention periods",
  "Cross-border transfer position when cloud AI is enabled",
  "Grievance officer and rights-request process",
  "Company identity and registered address",
];

export default function Page() {
  return <LegalPage title="Privacy notice" lead="How Fabric would handle personal information. Draft." sections={SECTIONS} review={REVIEW} />;
}
