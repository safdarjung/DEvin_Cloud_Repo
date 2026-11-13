import { meta } from "@/components/marketing/content";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = meta("Terms of service", "Draft terms of service for FabricOS. Requires legal review.", "/legal/terms");

const SECTIONS = [
  { h: "Status of this document", p: "This is a working draft prepared for internal review. It is not legal advice and has not been approved for publication." },
  { h: "What this will cover", p: "Account responsibilities, permitted use, fees and invoicing, service changes, liability and termination." },
  { h: "Pricing", p: "Plans are quoted per institution." },
];

const REVIEW = [
  "Contracting entity and governing law",
  "Fees, payment terms and refunds",
  "Service levels and support commitments",
  "Limitation of liability",
  "Termination and data return",
  "Children's data responsibilities of the institution",
];

export default function Page() {
  return <LegalPage title="Terms of service" lead="The terms that would govern use of FabricOS. Draft." sections={SECTIONS} review={REVIEW} />;
}
