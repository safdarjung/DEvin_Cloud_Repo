import { meta } from "@/components/marketing/content";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = meta("Data processing terms", "Draft data processing terms for Fabric. Requires legal review.", "/legal/data-processing");

const SECTIONS = [
  { h: "Status of this document", p: "This is a working draft prepared for internal review. It is not legal advice and has not been approved for publication." },
  { h: "What this will cover", p: "Roles of the parties, instructions, security measures, sub-processors, incident notice, audit, and deletion or return of data." },
  { h: "Technical controls", p: "Institution-scoped row-level security, permission checks, append-only audit events and a school-controlled AI cloud or local policy are described on the security page." },
];

const REVIEW = [
  "Controller and processor allocation under the DPDP Act, 2023",
  "Sub-processor list, including payment, messaging and AI providers when configured",
  "Children's data safeguards and parental consent flows",
  "Breach notification timelines",
  "Data location and cross-border transfers",
  "Retention and deletion schedule",
];

export default function Page() {
  return <LegalPage title="Data processing terms" lead="How Fabric would process institution data on the institution's behalf. Draft." sections={SECTIONS} review={REVIEW} />;
}
